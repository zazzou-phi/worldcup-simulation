import type { Team } from './types.js';

export interface RandomSource {
  random(): number;
}

export const defaultRandomSource: RandomSource = {
  random: () => Math.random(),
};

export const DEFAULT_GPG = 1.25;

/** Log-normal sigma for per-team match form; 0 disables upset variance. */
export const DEFAULT_UPSET_VARIANCE = 0.2;

export interface SimulatedMatchOutcome {
  team1Id: number;
  team1Name: string;
  team2Id: number;
  team2Name: string;
  lambda1: number;
  lambda2: number;
  goals1: number;
  goals2: number;
  winnerId?: number;
  pTeam1Wins?: number;
}

export interface MatchResultRow {
  matchNumber: number;
  goalsHome: number;
  goalsAway: number;
  winnerTeamId: number | null;
}

export interface GroupPhaseResult {
  simulationId: number;
  matchesPlayed: number;
  matchesSkipped: number;
  results: MatchResultRow[];
}

export interface KnockoutRoundResult {
  simulationId: number;
  round: string;
  matchesPlayed: number;
  matchesSkipped: number;
  results: MatchResultRow[];
}

export interface KnockoutsResult {
  simulationId: number;
  roundsPlayed: number;
  matchesPlayed: number;
  rounds: KnockoutRoundResult[];
}

export function sampleNormal(rng: RandomSource): number {
  const u1 = Math.max(rng.random(), Number.EPSILON);
  const u2 = rng.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Log-normal multiplier with mean 1 — models a team over- or under-performing for one match. */
export function sampleLogNormalMean1(rng: RandomSource, sigma: number): number {
  if (sigma <= 0) return 1;
  const z = sampleNormal(rng);
  return Math.exp(sigma * z - (sigma * sigma) / 2);
}

export function samplePoisson(lambda: number, rng: RandomSource): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.random();
  } while (p > L);
  return k - 1;
}

export function winnerFromGoals(
  goalsHome: number,
  goalsAway: number,
  teamHomeId: number,
  teamAwayId: number,
): number | null {
  if (goalsHome > goalsAway) return teamHomeId;
  if (goalsAway > goalsHome) return teamAwayId;
  return null;
}

export function simulateMatchOutcome(
  home: Team,
  away: Team,
  knockout: boolean,
  options: { gpg?: number; rng?: RandomSource; upsetVariance?: number } = {},
): SimulatedMatchOutcome {
  const gpg = options.gpg ?? DEFAULT_GPG;
  const rng = options.rng ?? defaultRandomSource;
  const upsetVariance = options.upsetVariance ?? DEFAULT_UPSET_VARIANCE;

  let lambda1 =
    gpg *
    (home.offensiveRating ?? home.eloOffensiveRating) *
    (away.defensiveRating ?? away.eloDefensiveRating);
  let lambda2 =
    gpg *
    (away.offensiveRating ?? away.eloOffensiveRating) *
    (home.defensiveRating ?? home.eloDefensiveRating);

  if (upsetVariance > 0) {
    const homeForm = sampleLogNormalMean1(rng, upsetVariance);
    const awayForm = sampleLogNormalMean1(rng, upsetVariance);
    lambda1 *= homeForm / awayForm;
    lambda2 *= awayForm / homeForm;
  }

  const goals1 = samplePoisson(lambda1, rng);
  const goals2 = samplePoisson(lambda2, rng);

  const result: SimulatedMatchOutcome = {
    team1Id: home.id,
    team1Name: home.name,
    team2Id: away.id,
    team2Name: away.name,
    lambda1,
    lambda2,
    goals1,
    goals2,
  };

  if (knockout) {
    if (goals1 > goals2) {
      result.winnerId = home.id;
    } else if (goals2 > goals1) {
      result.winnerId = away.id;
    } else {
      const pTeam1Wins = lambda1 / (lambda1 + lambda2);
      const team1Wins = rng.random() < pTeam1Wins;
      result.winnerId = team1Wins ? home.id : away.id;
      result.pTeam1Wins = pTeam1Wins;
    }
  }

  return result;
}
