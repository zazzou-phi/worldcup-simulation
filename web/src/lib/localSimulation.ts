import { resolveWinnerTeamId } from '@shared/api/scoring.js';
import { compareFixturesChronologically } from '@shared/engine/fixtureOrder.js';
import {
  isGroupFixtureWithinGamesTarget,
  type GroupGamesTarget,
} from '@shared/engine/groupSimulation.js';
import {
  simulateMatchOutcome,
  winnerFromGoals,
  type GroupPhaseResult,
  type KnockoutRoundResult,
  type KnockoutsResult,
  type MatchResultRow,
} from '@shared/engine/matchSimulator.js';
import { SIMULATION_KNOCKOUT_ROUNDS } from '@shared/engine/simulationRounds.js';
import {
  canClearSimulationResult,
  canModifySimulationResult,
  isGroupStageComplete,
} from '@shared/engine/phase.js';
import {
  applyActualResultsToMatches,
  buildTournamentStateFromData,
  createEmptyMatches,
} from '@shared/engine/tournamentState.js';
import type { PublicBootstrap } from '@shared/export/publicSnapshot.js';
import { teamForSimulation } from '@shared/engine/teamRatings.js';
import {
  computeSimulationRatings,
  recomputeEloDeltasFromSimulationState,
  type SimulationRatings,
} from '@shared/engine/tournamentElo.js';
import { DEFAULT_RATING_ELO_WEIGHT } from '../lib/ratingEloWeight.js';
import { DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT } from '../lib/tournamentEloDeltaWeight.js';
import { normalizeBootstrapTeams } from './normalizeTeam.js';
import type { Simulation, SimulationMatch, Team, TournamentState } from '../types.js';

const LOCAL_SIMULATION: Simulation = {
  id: 0,
  name: 'Your prediction',
  phase: 'group',
  annexCCombinationId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

function serializeLocalState(raw: ReturnType<typeof buildTournamentStateFromData>): TournamentState {
  return {
    ...raw,
    teams: Object.fromEntries([...raw.teams.entries()].map(([id, team]) => [String(id), team])),
    matches: raw.matches.map(({ simulationId: _sid, ...rest }) => rest),
    eloDeltas: Object.fromEntries(
      [...raw.eloDeltas.entries()].map(([id, delta]) => [String(id), delta]),
    ),
  };
}

export function createInitialLocalState(bootstrap: PublicBootstrap): TournamentState {
  const locked = new Set(bootstrap.actualResults.map((r) => r.matchNumber));
  let matches = createEmptyMatches(0, bootstrap.fixtures);
  matches = applyActualResultsToMatches(matches, bootstrap.actualResults);

  const raw = buildTournamentStateFromData({
    simulation: LOCAL_SIMULATION,
    teams: normalizeBootstrapTeams(bootstrap.teams as Team[]),
    fixtures: bootstrap.fixtures,
    matches,
    groupMemberships: bootstrap.groupMemberships,
    actualResults: bootstrap.actualResults,
    lockedMatchNumbers: locked,
  });

  return serializeLocalState(raw);
}

export class LocalSimulationError extends Error {}

function findResolvedMatch(state: TournamentState, matchNumber: number) {
  const resolved = state.resolvedMatches.find((m) => m.fixture.matchNumber === matchNumber);
  if (!resolved) {
    throw new LocalSimulationError('Match not found');
  }
  return resolved;
}

function toEngineMatches(state: TournamentState): SimulationMatch[] {
  return state.matches.map((m) => ({ ...m, simulationId: 0 }));
}

function lockedMatchNumbers(state: TournamentState): Set<number> {
  return new Set(state.actualResults.map((r) => r.matchNumber));
}

function fromEngineMatches(state: TournamentState, matches: SimulationMatch[]): TournamentState {
  const raw = buildTournamentStateFromData({
    simulation: state.simulation,
    teams: Object.values(state.teams),
    fixtures: state.fixtures,
    matches,
    groupMemberships: state.groupMemberships,
    actualResults: state.actualResults,
    lockedMatchNumbers: lockedMatchNumbers(state),
  });

  return serializeLocalState(raw);
}

function getSimulationRatingsForState(
  state: TournamentState,
  ratingEloWeight: number = DEFAULT_RATING_ELO_WEIGHT,
  deltaWeight: number = DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT,
): Map<number, SimulationRatings> {
  const teams = Object.values(state.teams);
  const deltas = recomputeEloDeltasFromSimulationState(
    teams,
    state.fixtures,
    toEngineMatches(state),
  );
  return computeSimulationRatings(teams, deltas, ratingEloWeight, deltaWeight);
}

function getTeam(state: TournamentState, teamId: number) {
  const team = state.teams[String(teamId)];
  if (!team) {
    throw new LocalSimulationError(`Team not found: ${teamId}`);
  }
  return team;
}

export function setLocalMatchScore(
  state: TournamentState,
  matchNumber: number,
  goalsHome: number,
  goalsAway: number,
  winnerTeamId?: number | null,
): TournamentState {
  const resolved = findResolvedMatch(state, matchNumber);
  if (resolved.isLocked) {
    throw new LocalSimulationError('Match is locked by an actual result');
  }
  if (!canModifySimulationResult(matchNumber, state.matches, state.fixtures, lockedMatchNumbers(state))) {
    throw new LocalSimulationError(
      `Cannot change match ${matchNumber}: later tournament round results exist (clear those first)`,
    );
  }

  const winner = resolveWinnerTeamId(resolved, goalsHome, goalsAway, winnerTeamId);
  const matches = toEngineMatches(state).map((match) =>
    match.matchNumber === matchNumber
      ? {
          ...match,
          goalsHome,
          goalsAway,
          winnerTeamId: winner,
          status: 'played' as const,
        }
      : match,
  );

  return fromEngineMatches(state, matches);
}

export function clearLocalMatchScore(
  state: TournamentState,
  matchNumber: number,
): TournamentState {
  const resolved = findResolvedMatch(state, matchNumber);
  if (resolved.isLocked) {
    throw new LocalSimulationError('Match is locked by an actual result');
  }
  if (!canClearSimulationResult(matchNumber, state.matches, state.fixtures, lockedMatchNumbers(state))) {
    throw new LocalSimulationError(
      `Cannot change match ${matchNumber}: later tournament round results exist (clear those first)`,
    );
  }

  const matches = toEngineMatches(state).map((match) =>
    match.matchNumber === matchNumber
      ? {
          ...match,
          goalsHome: null,
          goalsAway: null,
          winnerTeamId: null,
          status: 'scheduled' as const,
        }
      : match,
  );

  return fromEngineMatches(state, matches);
}

export function simulateLocalMatch(
  state: TournamentState,
  matchNumber: number,
  upsetVariance?: number,
  ratingEloWeight: number = DEFAULT_RATING_ELO_WEIGHT,
  deltaWeight: number = DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT,
): { state: TournamentState; result: MatchResultRow } {
  const resolved = findResolvedMatch(state, matchNumber);
  if (resolved.isLocked) {
    throw new LocalSimulationError('Match is locked by an actual result');
  }
  if (resolved.result.status === 'played') {
    throw new LocalSimulationError(`Match ${matchNumber} is already played`);
  }
  if (resolved.homeTeam == null || resolved.awayTeam == null) {
    throw new LocalSimulationError(`Match ${matchNumber} has unresolved participants`);
  }

  const isKnockout = resolved.fixture.group == null;
  const ratings = getSimulationRatingsForState(state, ratingEloWeight, deltaWeight);
  const outcome = simulateMatchOutcome(
    teamForSimulation(resolved.homeTeam, ratings.get(resolved.homeTeam.id)),
    teamForSimulation(resolved.awayTeam, ratings.get(resolved.awayTeam.id)),
    isKnockout,
    { upsetVariance },
  );
  const winnerTeamId = isKnockout
    ? (outcome.winnerId ?? null)
    : winnerFromGoals(
        outcome.goals1,
        outcome.goals2,
        resolved.homeTeam.id,
        resolved.awayTeam.id,
      );

  const nextState = setLocalMatchScore(
    state,
    matchNumber,
    outcome.goals1,
    outcome.goals2,
    winnerTeamId,
  );

  return {
    state: nextState,
    result: {
      matchNumber,
      goalsHome: outcome.goals1,
      goalsAway: outcome.goals2,
      winnerTeamId,
    },
  };
}

export function simulateLocalGroupPhase(
  state: TournamentState,
  gamesTarget: GroupGamesTarget,
  upsetVariance?: number,
  ratingEloWeight: number = DEFAULT_RATING_ELO_WEIGHT,
  deltaWeight: number = DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT,
): { state: TournamentState; result: GroupPhaseResult } {
  const fixtures = state.fixtures
    .filter((f) => f.group != null && isGroupFixtureWithinGamesTarget(f, gamesTarget))
    .sort(compareFixturesChronologically);

  let matches = toEngineMatches(state);
  const locked = lockedMatchNumbers(state);
  const results: MatchResultRow[] = [];
  let skipped = 0;

  for (const fixture of fixtures) {
    const { matchNumber } = fixture;
    if (locked.has(matchNumber)) {
      skipped++;
      continue;
    }

    const match = matches.find((m) => m.matchNumber === matchNumber);
    if (!match || match.status === 'played') {
      skipped++;
      continue;
    }

    if (fixture.teamHomeId == null || fixture.teamAwayId == null) {
      throw new LocalSimulationError(`Group fixture ${matchNumber} is missing team ids`);
    }

    const ratings = getSimulationRatingsForState(
      fromEngineMatches(state, matches),
      ratingEloWeight,
      deltaWeight,
    );
    const home = teamForSimulation(getTeam(state, fixture.teamHomeId), ratings.get(fixture.teamHomeId));
    const away = teamForSimulation(getTeam(state, fixture.teamAwayId), ratings.get(fixture.teamAwayId));
    const outcome = simulateMatchOutcome(home, away, false, { upsetVariance });
    const winnerTeamId = winnerFromGoals(outcome.goals1, outcome.goals2, home.id, away.id);

    matches = matches.map((row) =>
      row.matchNumber === matchNumber
        ? {
            ...row,
            goalsHome: outcome.goals1,
            goalsAway: outcome.goals2,
            winnerTeamId,
            status: 'played' as const,
          }
        : row,
    );

    results.push({
      matchNumber,
      goalsHome: outcome.goals1,
      goalsAway: outcome.goals2,
      winnerTeamId,
    });
  }

  return {
    state: fromEngineMatches(state, matches),
    result: {
      simulationId: state.simulation.id,
      matchesPlayed: results.length,
      matchesSkipped: skipped,
      results,
    },
  };
}

export function simulateLocalKnockouts(
  state: TournamentState,
  throughRoundName?: string,
  upsetVariance?: number,
  ratingEloWeight: number = DEFAULT_RATING_ELO_WEIGHT,
  deltaWeight: number = DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT,
): { state: TournamentState; result: KnockoutsResult } {
  const throughName =
    throughRoundName ?? SIMULATION_KNOCKOUT_ROUNDS[SIMULATION_KNOCKOUT_ROUNDS.length - 1]!.name;
  const throughIndex = SIMULATION_KNOCKOUT_ROUNDS.findIndex((r) => r.name === throughName);
  if (throughIndex < 0) {
    throw new LocalSimulationError(`Unknown knockout round: ${throughName}`);
  }

  let currentState = state;
  if (!isGroupStageComplete(toEngineMatches(currentState), currentState.fixtures)) {
    currentState = simulateLocalGroupPhase(
      currentState,
      3,
      upsetVariance,
      ratingEloWeight,
      deltaWeight,
    ).state;
  }

  const roundResults: KnockoutRoundResult[] = [];
  let totalMatches = 0;

  for (let i = 0; i <= throughIndex; i++) {
    const round = SIMULATION_KNOCKOUT_ROUNDS[i]!;
    let matches = toEngineMatches(currentState);
    const locked = lockedMatchNumbers(currentState);
    const results: MatchResultRow[] = [];
    let skipped = 0;

    for (const matchNumber of round.matches) {
      if (locked.has(matchNumber)) {
        skipped++;
        continue;
      }

      const match = matches.find((m) => m.matchNumber === matchNumber);
      if (!match) {
        throw new LocalSimulationError(`Unknown knockout match: ${matchNumber}`);
      }
      if (match.status === 'played') {
        skipped++;
        continue;
      }
      if (match.teamHomeId == null || match.teamAwayId == null) {
        throw new LocalSimulationError(`Knockout fixture ${matchNumber} has unresolved participants`);
      }

      const ratings = getSimulationRatingsForState(
        fromEngineMatches(currentState, matches),
        ratingEloWeight,
        deltaWeight,
      );
      const home = teamForSimulation(getTeam(currentState, match.teamHomeId), ratings.get(match.teamHomeId));
      const away = teamForSimulation(getTeam(currentState, match.teamAwayId), ratings.get(match.teamAwayId));
      const outcome = simulateMatchOutcome(home, away, true, { upsetVariance });
      const winnerTeamId = outcome.winnerId ?? null;

      matches = matches.map((row) =>
        row.matchNumber === matchNumber
          ? {
              ...row,
              goalsHome: outcome.goals1,
              goalsAway: outcome.goals2,
              winnerTeamId,
              status: 'played' as const,
            }
          : row,
      );

      results.push({
        matchNumber,
        goalsHome: outcome.goals1,
        goalsAway: outcome.goals2,
        winnerTeamId,
      });
    }

    currentState = fromEngineMatches(currentState, matches);
    roundResults.push({
      simulationId: currentState.simulation.id,
      round: round.name,
      matchesPlayed: results.length,
      matchesSkipped: skipped,
      results,
    });
    totalMatches += results.length;
  }

  return {
    state: currentState,
    result: {
      simulationId: currentState.simulation.id,
      roundsPlayed: roundResults.length,
      matchesPlayed: totalMatches,
      rounds: roundResults,
    },
  };
}
