import { teamForSimulation } from './teamRatings.js';
import type { Team } from './types.js';

interface RandomSource {
  random(): number;
}

/** Empirical shoot-out conversion rate (distinct from ~82% in-game penalties). */
export const DEFAULT_PENALTY_CONVERSION = 0.75;

/** How strongly team ratings shift per-kick conversion probability. */
export const PENALTY_SKILL_EXPONENT = 0.3;

export const PENALTY_RATE_MIN = 0.55;
export const PENALTY_RATE_MAX = 0.9;

/**
 * Per-team kick multipliers vs the ~74% shoot-out average (Jordet-style kick-round pattern).
 * Indexed by team kick number 1–5; kick 6+ uses the sudden-death slot.
 */
export const PENALTY_KICK_ROUND_MULTIPLIERS = [1.0, 1.02, 1.0, 0.91, 0.98, 0.88] as const;

export function kickRoundMultiplier(teamKickNumber: number): number {
  if (teamKickNumber <= 0) return 1;
  if (teamKickNumber <= 5) return PENALTY_KICK_ROUND_MULTIPLIERS[teamKickNumber - 1]!;
  return PENALTY_KICK_ROUND_MULTIPLIERS[5]!;
}

export function effectiveKickRate(baseRate: number, teamKickNumber: number): number {
  const rate = baseRate * kickRoundMultiplier(teamKickNumber);
  return Math.min(PENALTY_RATE_MAX, Math.max(PENALTY_RATE_MIN, rate));
}

export interface PenaltyShootoutResult {
  penGoalsHome: number;
  penGoalsAway: number;
  homeWins: boolean;
}

export function teamPenaltyRate(
  shooter: Team,
  goalkeeper: Team,
  base: number = DEFAULT_PENALTY_CONVERSION,
  gamma: number = PENALTY_SKILL_EXPONENT,
): number {
  const shooterSim = teamForSimulation(shooter);
  const gkSim = teamForSimulation(goalkeeper);
  const off = shooterSim.offensiveRating ?? shooterSim.blendOffensiveRating;
  const def = gkSim.defensiveRating ?? gkSim.blendDefensiveRating;
  const skill = off / def;
  const rate = base * skill ** gamma;
  return Math.min(PENALTY_RATE_MAX, Math.max(PENALTY_RATE_MIN, rate));
}

function leaderHasWon(leader: number, trailer: number, trailerKicksLeft: number): boolean {
  return leader > trailer + trailerKicksLeft;
}

function takeKick(baseRate: number, teamKickNumber: number, rng: RandomSource): boolean {
  return rng.random() < effectiveKickRate(baseRate, teamKickNumber);
}

export function simulatePenaltyShootout(
  pHome: number,
  pAway: number,
  rng: RandomSource,
): PenaltyShootoutResult {
  let penHome = 0;
  let penAway = 0;
  let homeKicks = 0;
  let awayKicks = 0;

  for (let round = 1; round <= 5; round++) {
    homeKicks++;
    if (takeKick(pHome, homeKicks, rng)) penHome++;
    const awayKicksLeftAfterHome = 6 - round;
    if (leaderHasWon(penHome, penAway, awayKicksLeftAfterHome)) {
      return { penGoalsHome: penHome, penGoalsAway: penAway, homeWins: true };
    }

    awayKicks++;
    if (takeKick(pAway, awayKicks, rng)) penAway++;
    const homeKicksLeft = 5 - round;
    if (leaderHasWon(penAway, penHome, homeKicksLeft)) {
      return { penGoalsHome: penHome, penGoalsAway: penAway, homeWins: false };
    }
  }

  if (penHome !== penAway) {
    return { penGoalsHome: penHome, penGoalsAway: penAway, homeWins: penHome > penAway };
  }

  while (true) {
    homeKicks++;
    const homeScores = takeKick(pHome, homeKicks, rng);
    if (homeScores) penHome++;

    awayKicks++;
    const awayScores = takeKick(pAway, awayKicks, rng);
    if (awayScores) penAway++;

    if (homeScores && !awayScores) {
      return { penGoalsHome: penHome, penGoalsAway: penAway, homeWins: true };
    }
    if (awayScores && !homeScores) {
      return { penGoalsHome: penHome, penGoalsAway: penAway, homeWins: false };
    }
  }
}
