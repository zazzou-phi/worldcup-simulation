import { chooseConsensus, type ConsensusMode, type MatchOutcome } from '@shared/engine/consensus.js';
import type { OutcomeDistribution, ResolvedMatch } from '../types.js';

export const MAX_DOUBLE_DOWN = 10;

function outcomeFromScoreline(goalsHome: number, goalsAway: number): MatchOutcome {
  if (goalsHome > goalsAway) return 'homeWin';
  if (goalsAway > goalsHome) return 'awayWin';
  return 'draw';
}

function savedSampleForMatch(
  sampleResults: Record<string, { goalsHome: number; goalsAway: number }> | undefined,
  matchNumber: number,
): { goalsHome: number; goalsAway: number } | null {
  if (!sampleResults) return null;
  const key = String(matchNumber);
  return sampleResults[key] ?? sampleResults[matchNumber as unknown as string] ?? null;
}

/** Simulations matching the consensus predicted outcome (home win / draw / away win). */
export function consensusOutcomeFrequency(
  dist: OutcomeDistribution,
  predicted: { goalsHome: number; goalsAway: number },
): number {
  if (dist.total === 0) return 0;
  const outcome = outcomeFromScoreline(predicted.goalsHome, predicted.goalsAway);
  if (outcome === 'homeWin') return dist.homeWin;
  if (outcome === 'draw') return dist.draw;
  return dist.awayWin;
}

export function predictedConsensusScore(
  match: ResolvedMatch,
  dist: OutcomeDistribution,
  mode: ConsensusMode,
  sampleResults?: Record<string, { goalsHome: number; goalsAway: number }>,
): { goalsHome: number; goalsAway: number } | null {
  if (!match.homeTeam || !match.awayTeam) return null;
  return chooseConsensus({
    mode,
    outcomeCounts: dist,
    scorelines: dist.scorelines,
    homeOffensive: match.homeTeam.eloOffensiveRating,
    awayOffensive: match.awayTeam.eloOffensiveRating,
    savedSample: savedSampleForMatch(sampleResults, match.fixture.matchNumber),
  });
}

/** Top-N group matches by consensus outcome frequency (ties: lower match number first). */
export function pickDoubleDownMatches(
  resolvedMatches: ResolvedMatch[],
  distributions: Record<string, OutcomeDistribution>,
  mode: ConsensusMode,
  count: number,
  eligibleMatchNumbers?: ReadonlySet<number>,
  sampleResults?: Record<string, { goalsHome: number; goalsAway: number }>,
): Set<number> {
  const limit = Math.max(0, Math.min(count, MAX_DOUBLE_DOWN));
  const matchesByNumber = new Map(
    resolvedMatches.map((match) => [match.fixture.matchNumber, match]),
  );

  const ranked = Object.entries(distributions)
    .map(([matchNumber, dist]) => {
      const match = matchesByNumber.get(Number(matchNumber));
      if (!match) return null;
      const predicted = predictedConsensusScore(match, dist, mode, sampleResults);
      if (!predicted) return null;
      return {
        matchNumber: Number(matchNumber),
        frequency: consensusOutcomeFrequency(dist, predicted),
      };
    })
    .filter(
      (entry): entry is { matchNumber: number; frequency: number } =>
        entry != null &&
        entry.frequency > 0 &&
        (eligibleMatchNumbers == null || eligibleMatchNumbers.has(entry.matchNumber)),
    )
    .sort((a, b) => b.frequency - a.frequency || a.matchNumber - b.matchNumber);

  return new Set(ranked.slice(0, limit).map((entry) => entry.matchNumber));
}

export function buildDoubledMatchNumbers(
  fixedMatchNumbers: ReadonlySet<number>,
  resolvedMatches: ResolvedMatch[],
  distributions: Record<string, OutcomeDistribution>,
  mode: ConsensusMode,
  totalCount: number,
  actualMatchNumbers: ReadonlySet<number>,
  sampleResults?: Record<string, { goalsHome: number; goalsAway: number }>,
): Set<number> {
  const fixed = new Set(
    [...fixedMatchNumbers].filter((matchNumber) => actualMatchNumbers.has(matchNumber)),
  );
  const remaining = Math.max(0, Math.min(totalCount, MAX_DOUBLE_DOWN) - fixed.size);
  const eligible = new Set(
    Object.keys(distributions)
      .map(Number)
      .filter((matchNumber) => !actualMatchNumbers.has(matchNumber)),
  );
  const autoPicked = pickDoubleDownMatches(
    resolvedMatches,
    distributions,
    mode,
    remaining,
    eligible,
    sampleResults,
  );
  return new Set([...fixed, ...autoPicked]);
}
