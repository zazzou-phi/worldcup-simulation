import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PENALTY_CONVERSION,
  effectiveKickRate,
  kickRoundMultiplier,
  simulatePenaltyShootout,
  teamPenaltyRate,
} from '../src/engine/penaltyShootout.js';
import type { RandomSource } from '../src/engine/matchSimulator.js';
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

describe('penaltyShootout', () => {
  it('rates stronger shooters above the base conversion rate', () => {
    const favorite = makeTeam(1, 2.0, 1.0);
    const underdog = makeTeam(2, 0.6, 1.0);
    expect(teamPenaltyRate(favorite, underdog)).toBeGreaterThan(DEFAULT_PENALTY_CONVERSION);
    expect(teamPenaltyRate(underdog, favorite)).toBeLessThan(DEFAULT_PENALTY_CONVERSION);
  });

  it('ends early when a team cannot be caught', () => {
    const rng: RandomSource = {
      random: (() => {
        let i = 0;
        return () => {
          const values = [0.1, 0.9, 0.1, 0.9, 0.1];
          return values[i++ % values.length];
        };
      })(),
    };
    const result = simulatePenaltyShootout(0.99, 0.01, rng);
    expect(result.penGoalsHome).toBeGreaterThan(result.penGoalsAway);
    expect(result.homeWins).toBe(true);
    expect(result.penGoalsHome + result.penGoalsAway).toBeLessThan(10);
  });

  it('uses sudden death when the first ten kicks are tied', () => {
    const rng: RandomSource = {
      random: (() => {
        let i = 0;
        return () => {
          const values = [
            0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.99,
          ];
          return values[i++] ?? 0.99;
        };
      })(),
    };
    const result = simulatePenaltyShootout(0.99, 0.99, rng);
    expect(result.penGoalsHome).toBe(6);
    expect(result.penGoalsAway).toBe(5);
    expect(result.homeWins).toBe(true);
  });

  it('applies lower conversion on later team kicks', () => {
    expect(kickRoundMultiplier(1)).toBeGreaterThan(kickRoundMultiplier(4));
    expect(kickRoundMultiplier(6)).toBeLessThan(kickRoundMultiplier(3));
    expect(effectiveKickRate(0.75, 4)).toBeCloseTo(0.75 * 0.91, 5);
    expect(effectiveKickRate(0.75, 7)).toBeCloseTo(0.75 * 0.88, 5);
  });

  it('shortens long shootouts versus flat conversion', () => {
    const n = 20_000;
    let longShootouts = 0;
    for (let i = 0; i < n; i++) {
      const result = simulatePenaltyShootout(0.75, 0.75, { random: Math.random });
      if (result.penGoalsHome + result.penGoalsAway >= 23) longShootouts++;
    }
    expect(longShootouts / n).toBeLessThan(0.005);
  });
});
