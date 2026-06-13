export type MatchOutcome = 'homeWin' | 'draw' | 'awayWin';

/** How master-view consensus picks a result. Default: expected. */
export type ConsensusMode = 'scoreline' | 'outcome' | 'expected' | 'rounded';

export const DEFAULT_CONSENSUS_MODE: ConsensusMode = 'expected';

export function parseConsensusMode(value: unknown): ConsensusMode {
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (raw === 'outcome' || raw === 'scoreline' || raw === 'expected' || raw === 'rounded') {
      return raw;
    }
  }
  return DEFAULT_CONSENSUS_MODE;
}

/** Default for new predictions; env override when set. */
export function getDefaultConsensusMode(): ConsensusMode {
  return getConsensusMode();
}

export function getConsensusMode(): ConsensusMode {
  const raw = process.env.CONSENSUS_MODE?.trim().toLowerCase();
  if (raw === 'outcome' || raw === 'scoreline' || raw === 'rounded') return raw;
  return DEFAULT_CONSENSUS_MODE;
}

export interface OutcomeCounts {
  homeWin: number;
  draw: number;
  awayWin: number;
}

export interface ScorelineCount {
  goalsHome: number;
  goalsAway: number;
  n: number;
}

/** Pick the consensus outcome from simulation counts with tie-break rules. */
export function chooseOutcome(
  counts: OutcomeCounts,
  homeOffensive: number,
  awayOffensive: number,
): MatchOutcome | null {
  const total = counts.homeWin + counts.draw + counts.awayWin;
  if (total === 0) return null;

  const maxCount = Math.max(counts.homeWin, counts.draw, counts.awayWin);
  let tied: MatchOutcome[] = (
    [
      ['homeWin', counts.homeWin],
      ['draw', counts.draw],
      ['awayWin', counts.awayWin],
    ] as const
  )
    .filter(([, count]) => count === maxCount)
    .map(([outcome]) => outcome);

  const hasWin = tied.some((o) => o === 'homeWin' || o === 'awayWin');
  if (hasWin && tied.includes('draw')) {
    tied = tied.filter((o) => o !== 'draw');
  }

  if (tied.length === 1) return tied[0]!;

  if (tied.includes('homeWin') && tied.includes('awayWin')) {
    return homeOffensive >= awayOffensive ? 'homeWin' : 'awayWin';
  }

  return tied[0]!;
}

function sortScorelinesByFrequency(scorelines: ScorelineCount[]): ScorelineCount[] {
  return [...scorelines].sort((a, b) => {
    if (b.n !== a.n) return b.n - a.n;
    return b.goalsHome + b.goalsAway - (a.goalsHome + a.goalsAway);
  });
}

/** Pick the most frequent scoreline across all simulations. */
export function chooseModalScoreline(
  scorelines: ScorelineCount[],
): { goalsHome: number; goalsAway: number } | null {
  if (scorelines.length === 0) return null;
  const best = sortScorelinesByFrequency(scorelines)[0]!;
  return { goalsHome: best.goalsHome, goalsAway: best.goalsAway };
}

type ScorelineRepresentative = ScorelineCount & { outcome: MatchOutcome };

function bestScorelineRepresentative(
  scorelines: ScorelineCount[],
  outcome: MatchOutcome,
): ScorelineRepresentative | null {
  const matching = scorelines.filter((s) => outcomeFromScoreline(s) === outcome);
  if (matching.length === 0) return null;
  const best = sortScorelinesByFrequency(matching)[0]!;
  return { ...best, outcome };
}

/**
 * Pick the modal scoreline within each outcome (home / draw / away), then the highest
 * among those three. Draw scorelines are not split across 0-0, 1-1, etc. when comparing.
 */
export function chooseRepresentativeScoreline(
  scorelines: ScorelineCount[],
  homeOffensive: number,
  awayOffensive: number,
): { goalsHome: number; goalsAway: number } | null {
  const reps = (
    [
      bestScorelineRepresentative(scorelines, 'homeWin'),
      bestScorelineRepresentative(scorelines, 'draw'),
      bestScorelineRepresentative(scorelines, 'awayWin'),
    ] as const
  ).filter((r): r is ScorelineRepresentative => r != null);
  if (reps.length === 0) return null;

  const maxCount = Math.max(...reps.map((r) => r.n));
  let tied = reps.filter((r) => r.n === maxCount);

  if (tied.length === 1) {
    const best = tied[0]!;
    return { goalsHome: best.goalsHome, goalsAway: best.goalsAway };
  }

  const drawRep = tied.find((r) => r.outcome === 'draw');
  if (drawRep) {
    return { goalsHome: drawRep.goalsHome, goalsAway: drawRep.goalsAway };
  }

  const homeRep = tied.find((r) => r.outcome === 'homeWin');
  const awayRep = tied.find((r) => r.outcome === 'awayWin');
  if (homeRep && awayRep) {
    return homeOffensive >= awayOffensive
      ? { goalsHome: homeRep.goalsHome, goalsAway: homeRep.goalsAway }
      : { goalsHome: awayRep.goalsHome, goalsAway: awayRep.goalsAway };
  }

  const best = tied[0]!;
  return { goalsHome: best.goalsHome, goalsAway: best.goalsAway };
}

/** Mean goals across simulations (fractional). */
export function computeMeanExpectedGoals(
  scorelines: ScorelineCount[],
): { goalsHome: number; goalsAway: number } | null {
  if (scorelines.length === 0) return null;

  let total = 0;
  let sumHome = 0;
  let sumAway = 0;
  for (const s of scorelines) {
    total += s.n;
    sumHome += s.goalsHome * s.n;
    sumAway += s.goalsAway * s.n;
  }
  if (total === 0) return null;

  return {
    goalsHome: sumHome / total,
    goalsAway: sumAway / total,
  };
}

/** Floored mean goals across simulations. */
export function computeFlooredExpectedGoals(
  scorelines: ScorelineCount[],
): { goalsHome: number; goalsAway: number } | null {
  const mean = computeMeanExpectedGoals(scorelines);
  if (!mean) return null;

  return {
    goalsHome: Math.floor(mean.goalsHome),
    goalsAway: Math.floor(mean.goalsAway),
  };
}

/** Rounded mean goals across simulations. */
export function computeRoundedExpectedGoals(
  scorelines: ScorelineCount[],
): { goalsHome: number; goalsAway: number } | null {
  const mean = computeMeanExpectedGoals(scorelines);
  if (!mean) return null;

  return {
    goalsHome: Math.round(mean.goalsHome),
    goalsAway: Math.round(mean.goalsAway),
  };
}

/**
 * Floored expected goals for the outcome; for wins, the modal scoreline within that
 * outcome (avoids extreme scores from means alone). Draws use the floored scoreline.
 */
export function chooseExpectedGoalsScoreline(
  scorelines: ScorelineCount[],
): { goalsHome: number; goalsAway: number } | null {
  const floored = computeFlooredExpectedGoals(scorelines);
  if (!floored) return null;

  const outcome = outcomeFromScoreline(floored);
  if (outcome === 'draw') return floored;

  return chooseScoreline(scorelines, outcome) ?? floored;
}

/** Pick the consensus scoreline for a chosen outcome from per-scoreline counts. */
export function chooseScoreline(
  scorelines: ScorelineCount[],
  outcome: MatchOutcome,
): { goalsHome: number; goalsAway: number } | null {
  const matching = scorelines.filter((s) => outcomeFromScoreline(s) === outcome);
  if (matching.length === 0) return null;

  const best = sortScorelinesByFrequency(matching)[0]!;
  return { goalsHome: best.goalsHome, goalsAway: best.goalsAway };
}

export interface ChooseConsensusInput {
  mode?: ConsensusMode;
  outcomeCounts: OutcomeCounts;
  scorelines: ScorelineCount[];
  homeOffensive: number;
  awayOffensive: number;
}

/** Pick master-view consensus using scoreline, expected, rounded, or outcome mode. */
export function chooseConsensus(input: ChooseConsensusInput): {
  goalsHome: number;
  goalsAway: number;
} | null {
  const mode = input.mode ?? getConsensusMode();
  if (mode === 'scoreline') {
    return chooseRepresentativeScoreline(
      input.scorelines,
      input.homeOffensive,
      input.awayOffensive,
    );
  }
  if (mode === 'expected') {
    return chooseExpectedGoalsScoreline(input.scorelines);
  }
  if (mode === 'rounded') {
    return computeRoundedExpectedGoals(input.scorelines);
  }

  const outcome = chooseOutcome(
    input.outcomeCounts,
    input.homeOffensive,
    input.awayOffensive,
  );
  if (outcome == null) return null;
  return chooseScoreline(input.scorelines, outcome);
}

function outcomeFromScoreline(s: Pick<ScorelineCount, 'goalsHome' | 'goalsAway'>): MatchOutcome {
  if (s.goalsHome > s.goalsAway) return 'homeWin';
  if (s.goalsAway > s.goalsHome) return 'awayWin';
  return 'draw';
}
