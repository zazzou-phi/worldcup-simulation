import { describe, it, expect } from 'vitest';
import {
  applyBlendRatingsToTeams,
  computeBlendedNormalizedRatings,
  computeNormalizedTeamRatings,
  normalizeRatings,
  rawEloRatings,
  rawGoalRatings,
} from '../src/engine/teamRatings.js';

describe('teamRatings', () => {
  it('normalizes elo and goal ratings to mean 1', () => {
    const inputs = [
      { elo: 2165, goalsFor: 1591, goalsAgainst: 697, total: 780 },
      { elo: 1423, goalsFor: 993, goalsAgainst: 826, total: 698 },
    ];
    const ratings = computeNormalizedTeamRatings(inputs);
    const meanEloOff =
      ratings.reduce((sum, row) => sum + row.eloOffensiveRating, 0) / ratings.length;
    const meanGoalOff =
      ratings.reduce((sum, row) => sum + row.goalOffensiveRating, 0) / ratings.length;
    const meanBlendOff =
      ratings.reduce((sum, row) => sum + row.blendOffensiveRating, 0) / ratings.length;
    expect(meanEloOff).toBeCloseTo(1, 10);
    expect(meanGoalOff).toBeCloseTo(1, 10);
    expect(meanBlendOff).toBeCloseTo(1, 10);
    expect(ratings[0]!.eloOffensiveRating).toBeGreaterThan(ratings[1]!.eloOffensiveRating);
    expect(ratings[0]!.goalOffensiveRating).toBeGreaterThan(ratings[1]!.goalOffensiveRating);
  });

  it('normalizes each axis independently', () => {
    const normalized = normalizeRatings([
      [2, 0.5],
      [1, 2],
    ]);
    expect(normalized).toEqual([
      [4 / 3, 0.5 / 1.25],
      [2 / 3, 2 / 1.25],
    ]);
  });

  it('computes raw goal ratings from per-game rates', () => {
    expect(rawGoalRatings(10, 5, 4)).toEqual([2.5, 1.25]);
  });

  it('computes raw elo ratings from elo delta', () => {
    const [off, def] = rawEloRatings(1500);
    expect(off).toBeCloseTo(1, 10);
    expect(def).toBeCloseTo(1, 10);
  });

  it('matches pure elo at weight 1 and pure goals at weight 0', () => {
    const inputs = [
      { elo: 2165, goalsFor: 1591, goalsAgainst: 697, total: 780 },
      { elo: 1423, goalsFor: 993, goalsAgainst: 826, total: 698 },
    ];
    const base = computeNormalizedTeamRatings(inputs);
    const eloBlend = computeBlendedNormalizedRatings(inputs, 1);
    const goalBlend = computeBlendedNormalizedRatings(inputs, 0);
    expect(eloBlend[0]).toEqual([
      base[0]!.eloOffensiveRating,
      base[0]!.eloDefensiveRating,
    ]);
    expect(goalBlend[1]).toEqual([
      base[1]!.goalOffensiveRating,
      base[1]!.goalDefensiveRating,
    ]);
  });

  it('applies blended ratings to teams', () => {
    const teams = applyBlendRatingsToTeams(
      [
        {
          id: 1,
          name: 'A',
          countryCode: null,
          flag: '',
          rank: 1,
          rating: 2165,
          elo: 2165,
          total: 780,
          goalsFor: 1591,
          goalsAgainst: 697,
          eloOffensiveRating: 2,
          eloDefensiveRating: 0.5,
          goalOffensiveRating: 1.5,
          goalDefensiveRating: 0.8,
          blendOffensiveRating: 1,
          blendDefensiveRating: 1,
        },
      ],
      0.5,
    );
    expect(teams[0]!.blendOffensiveRating).toBeGreaterThan(0);
    expect(teams[0]!.blendDefensiveRating).toBeGreaterThan(0);
  });
});
