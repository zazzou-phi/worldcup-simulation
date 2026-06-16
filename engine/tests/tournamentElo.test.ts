import { describe, it, expect } from 'vitest';
import {
  computeEloDeltasFromMatches,
  computeSimulationRatings,
  DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT,
  effectiveEloForSimulation,
  expectedScore,
  matchEloDelta,
  recomputeEloDeltasFromSimulationState,
} from '../src/engine/tournamentElo.js';
import type { Fixture, SimulationMatch, Team } from '../src/engine/types.js';

function makeTeam(id: number, elo: number): Team {
  return {
    id,
    name: `Team ${id}`,
    countryCode: null,
    flag: '',
    rank: id,
    rating: elo,
    elo,
    total: 100,
    goalsFor: 150,
    goalsAgainst: 100,
    eloOffensiveRating: 1,
    eloDefensiveRating: 1,
    goalOffensiveRating: 1,
    goalDefensiveRating: 1,
    blendOffensiveRating: 1,
    blendDefensiveRating: 1,
  };
}

describe('tournamentElo', () => {
  it('expectedScore favors the higher-rated team', () => {
    expect(expectedScore(1600, 1400)).toBeGreaterThan(0.5);
    expect(expectedScore(1400, 1600)).toBeLessThan(0.5);
  });

  it('matchEloDelta increases winner and decreases loser', () => {
    const [homeDelta, awayDelta] = matchEloDelta(1500, 1500, 2, 0);
    expect(homeDelta).toBeGreaterThan(0);
    expect(awayDelta).toBeLessThan(0);
    expect(homeDelta + awayDelta).toBeCloseTo(0, 5);
  });

  it('recompute is idempotent', () => {
    const teams = [makeTeam(1, 1600), makeTeam(2, 1400)];
    const matches = [
      {
        matchNumber: 1,
        teamHomeId: 1,
        teamAwayId: 2,
        goalsHome: 2,
        goalsAway: 1,
      },
    ];
    const first = computeEloDeltasFromMatches(teams, matches);
    const second = computeEloDeltasFromMatches(teams, matches);
    expect(first.size).toBe(2);
    expect(first.get(1)).toBeCloseTo(second.get(1)!, 10);
    expect(first.get(2)).toBeCloseTo(second.get(2)!, 10);
  });

  it('orders group matches before later knockout updates', () => {
    const teams = [makeTeam(1, 1500), makeTeam(2, 1500), makeTeam(3, 1500)];
    const fixtures: Fixture[] = [
      {
        matchNumber: 1,
        round: 'Matchday 1',
        date: '2026-06-11',
        time: '15:00',
        venue: 'A',
        group: 'A',
        slotHome: '1',
        slotAway: '2',
        teamHomeId: 1,
        teamAwayId: 2,
      },
      {
        matchNumber: 73,
        round: 'Round of 32',
        date: '2026-07-01',
        time: '15:00',
        venue: 'B',
        group: null,
        slotHome: '1',
        slotAway: '3',
        teamHomeId: 1,
        teamAwayId: 3,
      },
    ];
    const matches: SimulationMatch[] = [
      {
        simulationId: 1,
        matchNumber: 1,
        teamHomeId: 1,
        teamAwayId: 2,
        goalsHome: 2,
        goalsAway: 0,
        winnerTeamId: 1,
        status: 'played',
      },
      {
        simulationId: 1,
        matchNumber: 73,
        teamHomeId: 1,
        teamAwayId: 3,
        goalsHome: 1,
        goalsAway: 0,
        winnerTeamId: 1,
        status: 'played',
      },
    ];

    const deltas = recomputeEloDeltasFromSimulationState(teams, fixtures, matches);
    expect(deltas.get(1)).toBeGreaterThan(0);
    expect(deltas.get(2)).toBeLessThan(0);
    expect(deltas.get(3)).toBeLessThan(0);
  });

  it('computeSimulationRatings raises offensive rating after positive delta', () => {
    const teams = [makeTeam(1, 1800), makeTeam(2, 1200)];
    const baseline = computeSimulationRatings(teams, new Map(), 1);
    const boosted = computeSimulationRatings(
      teams,
      new Map([
        [1, 40],
        [2, -40],
      ]),
      1,
    );
    expect(boosted.get(1)!.offensiveRating).toBeGreaterThan(baseline.get(1)!.offensiveRating);
    expect(boosted.get(2)!.offensiveRating).toBeLessThan(baseline.get(2)!.offensiveRating);
  });

  it('effectiveEloForSimulation amplifies delta without changing base elo storage', () => {
    expect(effectiveEloForSimulation(1600, 20, 2)).toBe(1640);
    expect(effectiveEloForSimulation(1600, 20, 0)).toBe(1600);
  });

  it('computeSimulationRatings amplifies delta when beta is above 1', () => {
    const teams = [makeTeam(1, 1800), makeTeam(2, 1200)];
    const deltas = new Map([
      [1, 40],
      [2, -40],
    ]);
    const betaOne = computeSimulationRatings(teams, deltas, 1, 1);
    const betaTwo = computeSimulationRatings(teams, deltas, 1, 2);
    expect(betaTwo.get(1)!.offensiveRating).toBeGreaterThan(betaOne.get(1)!.offensiveRating);
    expect(betaTwo.get(2)!.offensiveRating).toBeLessThan(betaOne.get(2)!.offensiveRating);
  });

  it('defaults beta to DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT', () => {
    const teams = [makeTeam(1, 1500), makeTeam(2, 1500)];
    const deltas = new Map([[1, 32], [2, -32]]);
    const explicit = computeSimulationRatings(teams, deltas, 1, DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT);
    const defaulted = computeSimulationRatings(teams, deltas, 1);
    expect(defaulted.get(1)!.offensiveRating).toBeCloseTo(explicit.get(1)!.offensiveRating, 10);
  });
});
