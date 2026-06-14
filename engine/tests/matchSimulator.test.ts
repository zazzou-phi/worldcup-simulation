import { describe, it, expect } from 'vitest';
import {
  computeMatchLambdas,
  sampleLogNormalMean1,
  samplePoisson,
  simulateMatchOutcome,
  winnerFromGoals,
  type RandomSource,
} from '../src/engine/matchSimulator.js';
import type { Team } from '../src/engine/types.js';

function makeTeam(id: number, offensive: number, defensive: number): Team {
  return {
    id,
    name: `Team ${id}`,
    countryCode: null,
    flag: '',
    rank: id,
    rating: 1500,
    elo: 1500,
    total: 10,
    goalsFor: 10,
    goalsAgainst: 10,
    eloOffensiveRating: offensive,
    eloDefensiveRating: defensive,
    goalOffensiveRating: offensive,
    goalDefensiveRating: defensive,
    blendOffensiveRating: offensive,
    blendDefensiveRating: defensive,
    offensiveRating: offensive,
    defensiveRating: defensive,
  };
}

describe('matchSimulator', () => {
  it('computes winner from goals', () => {
    expect(winnerFromGoals(2, 1, 1, 2)).toBe(1);
    expect(winnerFromGoals(1, 2, 1, 2)).toBe(2);
    expect(winnerFromGoals(1, 1, 1, 2)).toBeNull();
  });

  it('returns zero goals for zero lambda', () => {
    const rng: RandomSource = { random: () => 0.5 };
    expect(samplePoisson(0, rng)).toBe(0);
  });

  it('computes base match lambdas from team ratings', () => {
    const home = makeTeam(1, 1.5, 0.8);
    const away = makeTeam(2, 1.0, 1.2);
    expect(computeMatchLambdas(home, away, 1.25)).toEqual({
      lambdaHome: 1.25 * 1.5 * 1.2,
      lambdaAway: 1.25 * 1.0 * 0.8,
    });
  });

  it('uses deterministic poisson draws', () => {
    const values = [0.1, 0.2, 0.3, 0.4, 0.5];
    let i = 0;
    const rng: RandomSource = { random: () => values[i++ % values.length] };
    expect(samplePoisson(1.25, rng)).toBeGreaterThanOrEqual(0);
  });

  it('breaks knockout ties using lambda-weighted bernoulli', () => {
    const home = makeTeam(1, 1, 1);
    const away = makeTeam(2, 1, 1);
    const rng: RandomSource = { random: () => 0.1 };

    const result = simulateMatchOutcome(home, away, true, { gpg: 1.25, rng, upsetVariance: 0 });
    expect(result.goals1).toBe(0);
    expect(result.goals2).toBe(0);
    expect(result.winnerId).toBe(1);
    expect(result.pTeam1Wins).toBe(0.5);
  });

  it('assigns winner from score in knockout without tie-break', () => {
    const home = makeTeam(1, 0, 0);
    const away = makeTeam(2, 0, 0);
    const rng: RandomSource = { random: () => 0.99 };
    const result = simulateMatchOutcome(home, away, true, { gpg: 0, rng, upsetVariance: 0 });
    expect(result.winnerId).toBeDefined();
  });

  it('log-normal form shocks have mean ~1', () => {
    const rng: RandomSource = { random: () => Math.random() };
    const samples = Array.from({ length: 5000 }, () => sampleLogNormalMean1(rng, 0.25));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeCloseTo(1, 1);
  });

  it('upset variance increases underdog win rate in mismatched fixtures', () => {
    const favorite = makeTeam(1, 2.4, 0.35);
    const underdog = makeTeam(2, 0.87, 0.95);
    const trials = 4000;

    function underdogWinRate(upsetVariance: number): number {
      let wins = 0;
      for (let i = 0; i < trials; i++) {
        const rng: RandomSource = { random: () => Math.random() };
        const result = simulateMatchOutcome(favorite, underdog, false, { upsetVariance });
        if (result.goals2 > result.goals1) wins++;
      }
      return wins / trials;
    }

    expect(underdogWinRate(0.35)).toBeGreaterThan(underdogWinRate(0));
  });
});
