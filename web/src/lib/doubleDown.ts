import type { OutcomeDistribution } from '../types.js';

export const MAX_DOUBLE_DOWN = 10;

/** Share of simulations with the modal home/draw/away outcome. */
export function outcomeConfidence(dist: OutcomeDistribution): number {
  if (dist.total === 0) return 0;
  return Math.max(dist.homeWin, dist.draw, dist.awayWin) / dist.total;
}

/** Top-N group matches by modal-outcome confidence (ties: lower match number first). */
export function pickDoubleDownMatches(
  distributions: Record<string, OutcomeDistribution>,
  count: number,
  eligibleMatchNumbers?: ReadonlySet<number>,
): Set<number> {
  const limit = Math.max(0, Math.min(count, MAX_DOUBLE_DOWN));
  const ranked = Object.entries(distributions)
    .map(([matchNumber, dist]) => ({
      matchNumber: Number(matchNumber),
      confidence: outcomeConfidence(dist),
    }))
    .filter(
      (entry) =>
        entry.confidence > 0 &&
        (eligibleMatchNumbers == null || eligibleMatchNumbers.has(entry.matchNumber)),
    )
    .sort((a, b) => b.confidence - a.confidence || a.matchNumber - b.matchNumber);

  return new Set(ranked.slice(0, limit).map((entry) => entry.matchNumber));
}
