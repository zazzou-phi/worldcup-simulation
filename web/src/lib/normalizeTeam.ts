import { applyBlendRatingsToTeams, computeNormalizedTeamRatings } from '@shared/engine/teamRatings.js';
import type { Team } from '../types.js';

type LegacyTeam = Team & {
  offensiveRating?: number;
  defensiveRating?: number;
};

/** Map a single API team row onto the Team shape. */
export function normalizeTeam(raw: LegacyTeam): Team {
  return normalizeBootstrapTeams([raw])[0]!;
}

/** Map bootstrap/API teams and derive stored ratings when missing. */
export function normalizeBootstrapTeams(rawTeams: LegacyTeam[]): Team[] {
  const computed = computeNormalizedTeamRatings(
    rawTeams.map((raw) => ({
      elo: raw.elo ?? raw.rating,
      goalsFor: raw.goalsFor,
      goalsAgainst: raw.goalsAgainst,
      total: raw.total,
    })),
  );

  return rawTeams.map((raw, index) => {
    const ratings = computed[index]!;
    const eloOffensiveRating =
      raw.eloOffensiveRating ?? raw.offensiveRating ?? ratings.eloOffensiveRating;
    const eloDefensiveRating =
      raw.eloDefensiveRating ?? raw.defensiveRating ?? ratings.eloDefensiveRating;

    return {
      id: raw.id,
      name: raw.name,
      countryCode: raw.countryCode,
      flag: raw.flag,
      rank: raw.rank,
      rating: raw.rating,
      elo: raw.elo ?? raw.rating,
      total: raw.total,
      goalsFor: raw.goalsFor,
      goalsAgainst: raw.goalsAgainst,
      eloOffensiveRating,
      eloDefensiveRating,
      goalOffensiveRating: raw.goalOffensiveRating ?? ratings.goalOffensiveRating,
      goalDefensiveRating: raw.goalDefensiveRating ?? ratings.goalDefensiveRating,
      blendOffensiveRating: raw.blendOffensiveRating ?? ratings.blendOffensiveRating,
      blendDefensiveRating: raw.blendDefensiveRating ?? ratings.blendDefensiveRating,
    };
  });
}

export function applyRatingEloWeightToStateTeams(
  teams: Record<string, Team>,
  eloWeight: number,
): Record<string, Team> {
  const list = applyBlendRatingsToTeams(Object.values(teams), eloWeight);
  return Object.fromEntries(list.map((team) => [String(team.id), team]));
}
