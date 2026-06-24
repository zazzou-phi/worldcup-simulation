import { chooseConsensus, type ConsensusMode, type MatchOutcome } from '@shared/engine/consensus.js';
import { SIMULATION_KNOCKOUT_ROUNDS } from '@shared/engine/simulationRounds.js';
import type { OutcomeDistribution, ResolvedMatch } from '../types.js';

export const MAX_DOUBLE_DOWN = 10;
export const KNOCKOUT_R32_DOUBLE_DOWN_COUNT = 1;

const roundOf32 = SIMULATION_KNOCKOUT_ROUNDS.find((round) => round.name === 'round_of_32');
export const KNOCKOUT_R32_MATCH_NUMBERS = new Set(roundOf32?.matches ?? []);

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
  options?: { preferPlayedResult?: boolean },
): { goalsHome: number; goalsAway: number } | null {
  if (
    options?.preferPlayedResult &&
    match.result.status === 'played' &&
    match.result.goalsHome != null &&
    match.result.goalsAway != null
  ) {
    return { goalsHome: match.result.goalsHome, goalsAway: match.result.goalsAway };
  }
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
  options?: { preferPlayedResult?: boolean },
): Set<number> {
  const limit = Math.max(0, Math.min(count, MAX_DOUBLE_DOWN));
  const matchesByNumber = new Map(
    resolvedMatches.map((match) => [match.fixture.matchNumber, match]),
  );

  const ranked = Object.entries(distributions)
    .map(([matchNumber, dist]) => {
      const match = matchesByNumber.get(Number(matchNumber));
      if (!match) return null;
      const predicted = predictedConsensusScore(match, dist, mode, sampleResults, options);
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
  options?: { preferPlayedResult?: boolean },
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
    options,
  );
  return new Set([...fixed, ...autoPicked]);
}

/** One double-down in the Round of 32, using the same pick logic as the group stage. */
export function buildKnockoutR32DoubledMatchNumbers(
  fixedMatchNumbers: ReadonlySet<number>,
  resolvedMatches: ResolvedMatch[],
  distributions: Record<string, OutcomeDistribution>,
  mode: ConsensusMode,
  actualMatchNumbers: ReadonlySet<number>,
): Set<number> {
  const r32Matches = resolvedMatches.filter((match) =>
    KNOCKOUT_R32_MATCH_NUMBERS.has(match.fixture.matchNumber),
  );
  const r32Distributions = Object.fromEntries(
    Object.entries(distributions).filter(([matchNumber]) =>
      KNOCKOUT_R32_MATCH_NUMBERS.has(Number(matchNumber)),
    ),
  );

  const fixed = new Set(
    [...fixedMatchNumbers].filter(
      (matchNumber) =>
        KNOCKOUT_R32_MATCH_NUMBERS.has(matchNumber) && actualMatchNumbers.has(matchNumber),
    ),
  );
  const remaining = Math.max(0, KNOCKOUT_R32_DOUBLE_DOWN_COUNT - fixed.size);
  let eligible = new Set(
    Object.keys(r32Distributions)
      .map(Number)
      .filter((matchNumber) => !actualMatchNumbers.has(matchNumber)),
  );
  if (eligible.size === 0) {
    eligible = new Set(Object.keys(r32Distributions).map(Number));
  }
  const autoPicked = pickDoubleDownMatches(
    r32Matches,
    r32Distributions,
    mode,
    remaining,
    eligible,
    undefined,
    { preferPlayedResult: true },
  );
  return new Set([...fixed, ...autoPicked]);
}
