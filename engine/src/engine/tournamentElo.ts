import { compareFixturesChronologically } from './fixtureOrder.js';
import {
  blendRawRatings,
  normalizeRatings,
  rawEloRatings,
  rawGoalRatings,
} from './teamRatings.js';
import type { Fixture, SimulationMatch, Team } from './types.js';

export const DEFAULT_TOURNAMENT_ELO_K = 32;
export const DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT = 2;
export const TOURNAMENT_ELO_DELTA_WEIGHT_MAX = 5;

export function effectiveEloForSimulation(
  baseElo: number,
  delta: number,
  deltaWeight: number = DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT,
): number {
  return baseElo + deltaWeight * delta;
}

export interface EloMatchInput {
  matchNumber: number;
  teamHomeId: number;
  teamAwayId: number;
  goalsHome: number;
  goalsAway: number;
}

export interface SimulationRatings {
  offensiveRating: number;
  defensiveRating: number;
}

export function expectedScore(eloA: number, eloB: number): number {
  return 1 / (1 + 10 ** ((eloB - eloA) / 400));
}

export function matchEloDelta(
  homeElo: number,
  awayElo: number,
  goalsHome: number,
  goalsAway: number,
  k: number = DEFAULT_TOURNAMENT_ELO_K,
): [number, number] {
  const expectedHome = expectedScore(homeElo, awayElo);
  const actualHome = goalsHome > goalsAway ? 1 : goalsHome === goalsAway ? 0.5 : 0;
  const homeDelta = k * (actualHome - expectedHome);
  const awayDelta = k * (1 - actualHome - (1 - expectedHome));
  return [homeDelta, awayDelta];
}

export function collectPlayedMatchesForElo(
  fixtures: Fixture[],
  matches: SimulationMatch[],
): EloMatchInput[] {
  const fixtureByMatch = new Map(fixtures.map((fixture) => [fixture.matchNumber, fixture]));

  return matches
    .filter(
      (match) =>
        match.status === 'played' &&
        match.teamHomeId != null &&
        match.teamAwayId != null &&
        match.goalsHome != null &&
        match.goalsAway != null &&
        fixtureByMatch.has(match.matchNumber),
    )
    .map((match) => ({
      match: {
        matchNumber: match.matchNumber,
        teamHomeId: match.teamHomeId!,
        teamAwayId: match.teamAwayId!,
        goalsHome: match.goalsHome!,
        goalsAway: match.goalsAway!,
      },
      fixture: fixtureByMatch.get(match.matchNumber)!,
    }))
    .sort((a, b) => compareFixturesChronologically(a.fixture, b.fixture))
    .map(({ match }) => match);
}

export function computeEloDeltasFromMatches(
  teams: Team[] | Map<number, Team>,
  matches: EloMatchInput[],
  k: number = DEFAULT_TOURNAMENT_ELO_K,
): Map<number, number> {
  const teamsById = teams instanceof Map ? teams : new Map(teams.map((team) => [team.id, team]));
  const deltas = new Map<number, number>();

  for (const match of matches) {
    const home = teamsById.get(match.teamHomeId);
    const away = teamsById.get(match.teamAwayId);
    if (!home || !away) continue;

    const homeElo = home.elo + (deltas.get(home.id) ?? 0);
    const awayElo = away.elo + (deltas.get(away.id) ?? 0);
    const [homeDelta, awayDelta] = matchEloDelta(
      homeElo,
      awayElo,
      match.goalsHome,
      match.goalsAway,
      k,
    );
    deltas.set(home.id, (deltas.get(home.id) ?? 0) + homeDelta);
    deltas.set(away.id, (deltas.get(away.id) ?? 0) + awayDelta);
  }

  return deltas;
}

/** Tournament delta only affects the Elo component of the blend; at α=0 this has no effect. */
export function computeSimulationRatings(
  teams: Team[],
  deltas: Map<number, number>,
  eloWeight: number,
  deltaWeight: number = DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT,
): Map<number, SimulationRatings> {
  const blendedRaw = teams.map((team) =>
    blendRawRatings(
      eloWeight,
      rawEloRatings(
        effectiveEloForSimulation(team.elo, deltas.get(team.id) ?? 0, deltaWeight),
      ),
      rawGoalRatings(team.goalsFor, team.goalsAgainst, team.total),
    ),
  );
  const normalized = normalizeRatings(blendedRaw);
  const result = new Map<number, SimulationRatings>();
  teams.forEach((team, index) => {
    const [offensiveRating, defensiveRating] = normalized[index]!;
    result.set(team.id, { offensiveRating, defensiveRating });
  });
  return result;
}

export function recomputeEloDeltasFromSimulationState(
  teams: Team[],
  fixtures: Fixture[],
  matches: SimulationMatch[],
  k: number = DEFAULT_TOURNAMENT_ELO_K,
): Map<number, number> {
  const played = collectPlayedMatchesForElo(fixtures, matches);
  return computeEloDeltasFromMatches(teams, played, k);
}
