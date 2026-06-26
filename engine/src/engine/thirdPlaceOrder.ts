import type { GroupStandings } from './types.js';
import type { ThirdPlaceOrderEntry } from './predictionKnockout.js';

export interface ThirdPlaceStats {
  points: number;
  goalDifference: number;
  goalsFor: number;
}

export function thirdPlaceStatsFromGroup(
  standings: GroupStandings[],
  groupLetter: string,
): ThirdPlaceStats {
  const group = standings.find((standing) => standing.groupLetter === groupLetter);
  const row = group?.rows[2];
  if (!row) {
    throw new Error(`Missing third-place row for group ${groupLetter}`);
  }
  return {
    points: row.points,
    goalDifference: row.goalDifference,
    goalsFor: row.goalsFor,
  };
}

/** Negative when `a` ranks above `b` on pts, GD, and GF. Zero when tied on all three. */
export function compareThirdPlaceStats(a: ThirdPlaceStats, b: ThirdPlaceStats): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.goalDifference !== b.goalDifference) return b.goalDifference - a.goalDifference;
  if (a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
  return 0;
}

export function areThirdPlaceTeamsTiedOnStats(a: ThirdPlaceStats, b: ThirdPlaceStats): boolean {
  return compareThirdPlaceStats(a, b) === 0;
}

export function validateThirdPlaceOrder(
  order: ThirdPlaceOrderEntry[],
  standings: GroupStandings[],
): void {
  const sorted = [...order].sort((a, b) => a.position - b.position);
  for (let index = 0; index < sorted.length - 1; index++) {
    const higher = sorted[index]!;
    const lower = sorted[index + 1]!;
    const higherStats = thirdPlaceStatsFromGroup(standings, higher.groupLetter);
    const lowerStats = thirdPlaceStatsFromGroup(standings, lower.groupLetter);
    if (compareThirdPlaceStats(higherStats, lowerStats) > 0) {
      throw new Error(
        `Third-place order is invalid: group ${higher.groupLetter} cannot rank above group ${lower.groupLetter} on points, goal difference, and goals scored`,
      );
    }
  }
}

export function isValidThirdPlaceOrder(
  order: ThirdPlaceOrderEntry[],
  standings: GroupStandings[],
): boolean {
  try {
    validateThirdPlaceOrder(order, standings);
    return true;
  } catch {
    return false;
  }
}
