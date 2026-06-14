import type { Team } from './types.js';

export const ELO_BASE = 1500;
export const ELO_SCALE = 400;

export const DEFAULT_RATING_ELO_WEIGHT = 1;

export interface TeamRatingInput {
  elo: number;
  goalsFor: number;
  goalsAgainst: number;
  total: number;
}

export function rawEloRatings(elo: number): [number, number] {
  const eloDelta = (elo - ELO_BASE) / ELO_SCALE;
  return [Math.exp(eloDelta), Math.exp(-eloDelta)];
}

export function rawGoalRatings(
  goalsFor: number,
  goalsAgainst: number,
  matches: number,
): [number, number] {
  if (matches <= 0) {
    throw new Error(`matches must be positive, got ${matches}`);
  }
  return [goalsFor / matches, goalsAgainst / matches];
}

export function normalizeRatings(
  pairs: Array<[number, number]>,
): Array<[number, number]> {
  const meanOff = pairs.reduce((sum, [off]) => sum + off, 0) / pairs.length;
  const meanDef = pairs.reduce((sum, [, def]) => sum + def, 0) / pairs.length;
  return pairs.map(([off, def]) => [off / meanOff, def / meanDef]);
}

export function blendRawRatings(
  eloWeight: number,
  eloPair: [number, number],
  goalPair: [number, number],
): [number, number] {
  const goalWeight = 1 - eloWeight;
  return [
    eloWeight * eloPair[0] + goalWeight * goalPair[0],
    eloWeight * eloPair[1] + goalWeight * goalPair[1],
  ];
}

export function computeBlendedNormalizedRatings(
  inputs: TeamRatingInput[],
  eloWeight: number,
): Array<[number, number]> {
  const blendedRaw = inputs.map((input) =>
    blendRawRatings(
      eloWeight,
      rawEloRatings(input.elo),
      rawGoalRatings(input.goalsFor, input.goalsAgainst, input.total),
    ),
  );
  return normalizeRatings(blendedRaw);
}

export function computeNormalizedTeamRatings(inputs: TeamRatingInput[]): Array<{
  eloOffensiveRating: number;
  eloDefensiveRating: number;
  goalOffensiveRating: number;
  goalDefensiveRating: number;
  blendOffensiveRating: number;
  blendDefensiveRating: number;
}> {
  const eloNormalized = normalizeRatings(inputs.map((input) => rawEloRatings(input.elo)));
  const goalNormalized = normalizeRatings(
    inputs.map((input) => rawGoalRatings(input.goalsFor, input.goalsAgainst, input.total)),
  );
  const blendNormalized = computeBlendedNormalizedRatings(inputs, DEFAULT_RATING_ELO_WEIGHT);

  return inputs.map((_, index) => ({
    eloOffensiveRating: eloNormalized[index]![0],
    eloDefensiveRating: eloNormalized[index]![1],
    goalOffensiveRating: goalNormalized[index]![0],
    goalDefensiveRating: goalNormalized[index]![1],
    blendOffensiveRating: blendNormalized[index]![0],
    blendDefensiveRating: blendNormalized[index]![1],
  }));
}

export function teamForSimulation(
  team: Team,
  ratings?: { offensiveRating: number; defensiveRating: number },
): Team {
  if (ratings) {
    return {
      ...team,
      offensiveRating: ratings.offensiveRating,
      defensiveRating: ratings.defensiveRating,
    };
  }
  return {
    ...team,
    offensiveRating: team.blendOffensiveRating,
    defensiveRating: team.blendDefensiveRating,
  };
}

export function applyBlendRatingsToTeams(teams: Team[], eloWeight: number): Team[] {
  const blended = computeBlendedNormalizedRatings(
    teams.map((team) => ({
      elo: team.elo ?? team.rating,
      goalsFor: team.goalsFor,
      goalsAgainst: team.goalsAgainst,
      total: team.total,
    })),
    eloWeight,
  );
  return teams.map((team, index) => ({
    ...team,
    blendOffensiveRating: blended[index]![0],
    blendDefensiveRating: blended[index]![1],
  }));
}
