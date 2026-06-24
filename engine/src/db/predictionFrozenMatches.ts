import { eq, and, desc } from 'drizzle-orm';
import type { Db } from './client.js';
import * as schema from './schema.js';
import {
  readPredictionMatchDistributions,
  removeLiveMatchFromAggregates,
  type PredictionMatchOutcomeCounts,
  type PredictionMatchScorelineCount,
} from './predictionAggregates.js';
import {
  buildSimulationIdSqlFilter,
  countIdsInSpec,
  parseSelectionSpecJson,
  type SelectionSpec,
} from '../lib/simulationSelection.js';
import { parseConsensusMode, type ConsensusMode } from '../engine/consensus.js';
import {
  resolveSampleGoalsForFreeze,
  upsertPredictionSampleResult,
  readPredictionSampleResults,
} from './predictionSample.js';

export interface FrozenMatchDistribution {
  outcomes: PredictionMatchOutcomeCounts;
  scorelines: PredictionMatchScorelineCount[];
  frozenAt: string;
  sampleGoals?: { goalsHome: number; goalsAway: number } | null;
}

function aggregateFromGroupMatchResults(
  db: Db,
  predictionId: number,
  matchNumber: number,
): { outcomes: PredictionMatchOutcomeCounts; scorelines: PredictionMatchScorelineCount[] } | null {
  const rows = db
    .select()
    .from(schema.predictionGroupMatchResults)
    .where(
      and(
        eq(schema.predictionGroupMatchResults.predictionId, predictionId),
        eq(schema.predictionGroupMatchResults.matchNumber, matchNumber),
      ),
    )
    .all();

  if (rows.length === 0) return null;

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  const scorelineCounts = new Map<string, PredictionMatchScorelineCount>();

  for (const row of rows) {
    if (row.goalsHome > row.goalsAway) homeWin++;
    else if (row.goalsHome < row.goalsAway) awayWin++;
    else draw++;

    const key = `${row.goalsHome}:${row.goalsAway}`;
    const existing = scorelineCounts.get(key);
    if (existing) existing.n++;
    else scorelineCounts.set(key, { goalsHome: row.goalsHome, goalsAway: row.goalsAway, n: 1 });
  }

  return {
    outcomes: { homeWin, draw, awayWin, total: rows.length },
    scorelines: [...scorelineCounts.values()],
  };
}

function aggregateLockedMatchFromSimulations(
  db: Db,
  predictionId: number,
  matchNumber: number,
  spec: SelectionSpec,
): { outcomes: PredictionMatchOutcomeCounts; scorelines: PredictionMatchScorelineCount[] } | null {
  const actual = db
    .select({
      goalsHome: schema.actualMatchResults.goalsHome,
      goalsAway: schema.actualMatchResults.goalsAway,
      recordedAt: schema.actualMatchResults.recordedAt,
    })
    .from(schema.actualMatchResults)
    .where(eq(schema.actualMatchResults.matchNumber, matchNumber))
    .get();
  if (!actual) return null;

  const simFilter = buildSimulationIdSqlFilter(spec).replaceAll('sm.simulation_id', 's.id');
  const sqlite = (db as { $client?: import('better-sqlite3').Database }).$client;
  if (!sqlite) return null;

  const rows = sqlite
    .prepare(
      `SELECT sm.goals_home AS goalsHome, sm.goals_away AS goalsAway
       FROM simulation_matches sm
       INNER JOIN simulations s ON s.id = sm.simulation_id
       INNER JOIN fixtures f ON f.match_number = sm.match_number
       WHERE sm.match_number = ?
         AND f."group" IS NOT NULL
         AND sm.status = 'played'
         AND sm.goals_home IS NOT NULL
         AND sm.goals_away IS NOT NULL
         AND s.created_at <= ?
         AND ${simFilter}`,
    )
    .all(matchNumber, actual.recordedAt) as Array<{ goalsHome: number; goalsAway: number }>;

  if (rows.length === 0) return null;

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  const scorelineCounts = new Map<string, PredictionMatchScorelineCount>();

  for (const row of rows) {
    if (row.goalsHome > row.goalsAway) homeWin++;
    else if (row.goalsHome < row.goalsAway) awayWin++;
    else draw++;

    const key = `${row.goalsHome}:${row.goalsAway}`;
    const existing = scorelineCounts.get(key);
    if (existing) existing.n++;
    else scorelineCounts.set(key, { goalsHome: row.goalsHome, goalsAway: row.goalsAway, n: 1 });
  }

  return {
    outcomes: { homeWin, draw, awayWin, total: rows.length },
    scorelines: [...scorelineCounts.values()],
  };
}

function readPredictionConsensusMode(db: Db, predictionId: number): ConsensusMode {
  const row = db
    .select({ consensusMode: schema.predictions.consensusMode })
    .from(schema.predictions)
    .where(eq(schema.predictions.id, predictionId))
    .get();
  return parseConsensusMode(row?.consensusMode);
}

function readLockedSampleFromActual(
  db: Db,
  matchNumber: number,
): { goalsHome: number; goalsAway: number } | null {
  const row = db
    .select({
      predictedGoalsHome: schema.actualMatchResults.predictedGoalsHome,
      predictedGoalsAway: schema.actualMatchResults.predictedGoalsAway,
    })
    .from(schema.actualMatchResults)
    .where(eq(schema.actualMatchResults.matchNumber, matchNumber))
    .get();
  if (row?.predictedGoalsHome == null || row?.predictedGoalsAway == null) return null;
  return { goalsHome: row.predictedGoalsHome, goalsAway: row.predictedGoalsAway };
}

/** Locked sample scores stored on actual results override Default floor backfills. */
function resolveFrozenConsensusForBackfill(
  db: Db,
  matchNumber: number,
  sourceConsensusMode: ConsensusMode,
  sourceSample: { goalsHome: number; goalsAway: number } | null,
): { consensusMode: ConsensusMode; sampleGoals: { goalsHome: number; goalsAway: number } | null } {
  const actualSample = readLockedSampleFromActual(db, matchNumber);
  if (actualSample) {
    return { consensusMode: 'sample', sampleGoals: actualSample };
  }
  return { consensusMode: sourceConsensusMode, sampleGoals: sourceSample };
}

function writeFrozenMatch(
  db: Db,
  predictionId: number,
  matchNumber: number,
  outcomes: PredictionMatchOutcomeCounts,
  scorelines: PredictionMatchScorelineCount[],
  frozenAt: string,
  consensusMode: ConsensusMode,
  sampleGoals: { goalsHome: number; goalsAway: number } | null = null,
): void {
  db.insert(schema.predictionFrozenMatches)
    .values({
      predictionId,
      matchNumber,
      homeWin: outcomes.homeWin,
      draw: outcomes.draw,
      awayWin: outcomes.awayWin,
      total: outcomes.total,
      scorelinesJson: JSON.stringify(scorelines),
      consensusMode,
      sampleGoalsHome: sampleGoals?.goalsHome ?? null,
      sampleGoalsAway: sampleGoals?.goalsAway ?? null,
      frozenAt,
    })
    .run();
  removeLiveMatchFromAggregates(db, predictionId, matchNumber);
}

function upsertFrozenMatch(
  db: Db,
  predictionId: number,
  matchNumber: number,
  outcomes: PredictionMatchOutcomeCounts,
  scorelines: PredictionMatchScorelineCount[],
  frozenAt: string,
  consensusMode: ConsensusMode,
  sampleGoals: { goalsHome: number; goalsAway: number } | null = null,
): void {
  db.delete(schema.predictionFrozenMatches)
    .where(
      and(
        eq(schema.predictionFrozenMatches.predictionId, predictionId),
        eq(schema.predictionFrozenMatches.matchNumber, matchNumber),
      ),
    )
    .run();
  writeFrozenMatch(
    db,
    predictionId,
    matchNumber,
    outcomes,
    scorelines,
    frozenAt,
    consensusMode,
    sampleGoals,
  );
}

export const CANONICAL_FROZEN_PREDICTION_ID = 1;

export function readLockedMatchNumbers(db: Db): Set<number> {
  const rows = db.select({ matchNumber: schema.actualMatchResults.matchNumber }).from(schema.actualMatchResults).all();
  return new Set(rows.map((row) => row.matchNumber));
}

export function readFrozenMatchDistributions(
  db: Db,
  predictionId: number,
): {
  outcomesByMatch: Map<number, PredictionMatchOutcomeCounts>;
  scorelinesByMatch: Map<number, PredictionMatchScorelineCount[]>;
  consensusModesByMatch: Map<number, ConsensusMode>;
  sampleGoalsByMatch: Map<number, { goalsHome: number; goalsAway: number }>;
} {
  const rows = db
    .select()
    .from(schema.predictionFrozenMatches)
    .where(eq(schema.predictionFrozenMatches.predictionId, predictionId))
    .all();

  const outcomesByMatch = new Map(
    rows.map((row) => [
      row.matchNumber,
      {
        homeWin: row.homeWin,
        draw: row.draw,
        awayWin: row.awayWin,
        total: row.total,
      },
    ]),
  );

  const scorelinesByMatch = new Map<number, PredictionMatchScorelineCount[]>();
  const consensusModesByMatch = new Map<number, ConsensusMode>();
  const sampleGoalsByMatch = new Map<number, { goalsHome: number; goalsAway: number }>();
  for (const row of rows) {
    scorelinesByMatch.set(row.matchNumber, JSON.parse(row.scorelinesJson) as PredictionMatchScorelineCount[]);
    consensusModesByMatch.set(row.matchNumber, parseConsensusMode(row.consensusMode));
    if (row.sampleGoalsHome != null && row.sampleGoalsAway != null) {
      sampleGoalsByMatch.set(row.matchNumber, {
        goalsHome: row.sampleGoalsHome,
        goalsAway: row.sampleGoalsAway,
      });
    }
  }

  return { outcomesByMatch, scorelinesByMatch, consensusModesByMatch, sampleGoalsByMatch };
}

export function readCanonicalLockedSampleGoals(
  db: Db,
  defaultPredictionId = CANONICAL_FROZEN_PREDICTION_ID,
): Map<number, { goalsHome: number; goalsAway: number }> {
  const defaultFrozen = readFrozenMatchDistributions(db, defaultPredictionId);
  const locked = readLockedMatchNumbers(db);
  const samples = new Map<number, { goalsHome: number; goalsAway: number }>();

  for (const matchNumber of locked) {
    if (defaultFrozen.consensusModesByMatch.get(matchNumber) !== 'sample') continue;
    const sample = defaultFrozen.sampleGoalsByMatch.get(matchNumber);
    if (sample) samples.set(matchNumber, sample);
  }

  return samples;
}

/** Sample prediction to store on the match when an actual group result is first entered. */
export function resolveLockedSamplePredictionForEntry(
  db: Db,
  matchNumber: number,
): { goalsHome: number; goalsAway: number } | null {
  const fixture = db
    .select({ group: schema.fixtures.group })
    .from(schema.fixtures)
    .where(eq(schema.fixtures.matchNumber, matchNumber))
    .get();
  if (fixture?.group == null) return null;

  const active = db
    .select({
      id: schema.predictions.id,
      consensusMode: schema.predictions.consensusMode,
      selectionSpec: schema.predictions.selectionSpec,
    })
    .from(schema.predictions)
    .orderBy(desc(schema.predictions.updatedAt))
    .limit(1)
    .get();

  const predictions = db
    .select({
      id: schema.predictions.id,
      consensusMode: schema.predictions.consensusMode,
      selectionSpec: schema.predictions.selectionSpec,
    })
    .from(schema.predictions)
    .all();

  let best: { goalsHome: number; goalsAway: number } | null = null;
  let bestWeight = -1;

  for (const prediction of predictions) {
    if (parseConsensusMode(prediction.consensusMode) !== 'sample') continue;
    const sample = readPredictionSampleResults(db, prediction.id).get(matchNumber);
    if (!sample) continue;

    const spec = parseSelectionSpecJson(prediction.selectionSpec);
    let weight = countIdsInSpec(spec);
    if (active?.id === prediction.id) weight += 1_000_000_000;

    if (weight > bestWeight) {
      best = { goalsHome: sample.goalsHome, goalsAway: sample.goalsAway };
      bestWeight = weight;
    }
  }

  return best;
}

export function readLockedMatchSampleGoalsFromActuals(
  db: Db,
): Map<number, { goalsHome: number; goalsAway: number }> {
  const rows = db
    .select({
      matchNumber: schema.actualMatchResults.matchNumber,
      predictedGoalsHome: schema.actualMatchResults.predictedGoalsHome,
      predictedGoalsAway: schema.actualMatchResults.predictedGoalsAway,
    })
    .from(schema.actualMatchResults)
    .all();

  const samples = new Map<number, { goalsHome: number; goalsAway: number }>();
  for (const row of rows) {
    if (row.predictedGoalsHome == null || row.predictedGoalsAway == null) continue;
    samples.set(row.matchNumber, {
      goalsHome: row.predictedGoalsHome,
      goalsAway: row.predictedGoalsAway,
    });
  }
  return samples;
}

export function readEffectiveFrozenMatchDistributions(
  db: Db,
  predictionId: number,
  defaultPredictionId = CANONICAL_FROZEN_PREDICTION_ID,
): {
  outcomesByMatch: Map<number, PredictionMatchOutcomeCounts>;
  scorelinesByMatch: Map<number, PredictionMatchScorelineCount[]>;
  consensusModesByMatch: Map<number, ConsensusMode>;
  sampleGoalsByMatch: Map<number, { goalsHome: number; goalsAway: number }>;
} {
  const own = readFrozenMatchDistributions(db, predictionId);
  if (predictionId === defaultPredictionId) return own;

  const fallback = readFrozenMatchDistributions(db, defaultPredictionId);
  const locked = readLockedMatchNumbers(db);
  const outcomesByMatch = new Map(own.outcomesByMatch);
  const scorelinesByMatch = new Map(own.scorelinesByMatch);
  const consensusModesByMatch = new Map(own.consensusModesByMatch);
  const sampleGoalsByMatch = new Map(own.sampleGoalsByMatch);

  for (const matchNumber of locked) {
    const defaultMode = fallback.consensusModesByMatch.get(matchNumber);
    const defaultSample = fallback.sampleGoalsByMatch.get(matchNumber);
    if (defaultMode === 'sample' && defaultSample) {
      sampleGoalsByMatch.set(matchNumber, defaultSample);
    } else if (!sampleGoalsByMatch.has(matchNumber) && defaultSample) {
      sampleGoalsByMatch.set(matchNumber, defaultSample);
    }

    const ownOutcome = outcomesByMatch.get(matchNumber);
    if (ownOutcome && ownOutcome.total > 0) continue;

    const fallbackOutcome = fallback.outcomesByMatch.get(matchNumber);
    if (!fallbackOutcome || fallbackOutcome.total === 0) continue;

    outcomesByMatch.set(matchNumber, fallbackOutcome);
    scorelinesByMatch.set(matchNumber, fallback.scorelinesByMatch.get(matchNumber) ?? []);
    consensusModesByMatch.set(
      matchNumber,
      fallback.consensusModesByMatch.get(matchNumber) ?? parseConsensusMode(undefined),
    );
    const fallbackSample = fallback.sampleGoalsByMatch.get(matchNumber);
    if (fallbackSample) {
      sampleGoalsByMatch.set(matchNumber, fallbackSample);
    }
  }

  return { outcomesByMatch, scorelinesByMatch, consensusModesByMatch, sampleGoalsByMatch };
}

function readDefaultFrozenRow(
  db: Db,
  matchNumber: number,
  defaultPredictionId = CANONICAL_FROZEN_PREDICTION_ID,
) {
  return db
    .select()
    .from(schema.predictionFrozenMatches)
    .where(
      and(
        eq(schema.predictionFrozenMatches.predictionId, defaultPredictionId),
        eq(schema.predictionFrozenMatches.matchNumber, matchNumber),
      ),
    )
    .get();
}

function sampleGoalsForFreeze(
  db: Db,
  predictionId: number,
  matchNumber: number,
  consensusMode: ConsensusMode,
  frozenAt: string,
): { goalsHome: number; goalsAway: number } | null {
  if (consensusMode !== 'sample') return null;
  const sampleGoals = resolveSampleGoalsForFreeze(db, predictionId, matchNumber);
  if (!sampleGoals) return null;
  upsertPredictionSampleResult(
    db,
    predictionId,
    matchNumber,
    sampleGoals.goalsHome,
    sampleGoals.goalsAway,
    frozenAt,
  );
  return sampleGoals;
}

export function freezePredictionMatch(
  db: Db,
  predictionId: number,
  matchNumber: number,
  frozenAt: string,
): void {
  const existing = db
    .select({ matchNumber: schema.predictionFrozenMatches.matchNumber })
    .from(schema.predictionFrozenMatches)
    .where(
      and(
        eq(schema.predictionFrozenMatches.predictionId, predictionId),
        eq(schema.predictionFrozenMatches.matchNumber, matchNumber),
      ),
    )
    .get();
  if (existing) return;

  const { outcomesByMatch, scorelinesByMatch } = readPredictionMatchDistributions(db, predictionId);
  const outcomes = outcomesByMatch.get(matchNumber) ?? {
    homeWin: 0,
    draw: 0,
    awayWin: 0,
    total: 0,
  };
  const scorelines = scorelinesByMatch.get(matchNumber) ?? [];
  const consensusMode = readPredictionConsensusMode(db, predictionId);
  const sampleGoals = sampleGoalsForFreeze(db, predictionId, matchNumber, consensusMode, frozenAt);

  writeFrozenMatch(
    db,
    predictionId,
    matchNumber,
    outcomes,
    scorelines,
    frozenAt,
    consensusMode,
    sampleGoals,
  );
}

export function freezeMatchForAllPredictions(db: Db, matchNumber: number, frozenAt: string): void {
  const predictions = db.select({ id: schema.predictions.id }).from(schema.predictions).all();
  for (const prediction of predictions) {
    freezePredictionMatch(db, prediction.id, matchNumber, frozenAt);
  }
}

export function backfillFrozenMatchesForPrediction(
  db: Db,
  predictionId: number,
  spec: SelectionSpec,
): void {
  const lockedRows = db
    .select({
      matchNumber: schema.actualMatchResults.matchNumber,
      recordedAt: schema.actualMatchResults.recordedAt,
    })
    .from(schema.actualMatchResults)
    .all();

  for (const { matchNumber, recordedAt } of lockedRows) {
    const fixture = db
      .select({ group: schema.fixtures.group })
      .from(schema.fixtures)
      .where(eq(schema.fixtures.matchNumber, matchNumber))
      .get();
    if (fixture?.group == null) continue;

    const existing = db
      .select({ matchNumber: schema.predictionFrozenMatches.matchNumber })
      .from(schema.predictionFrozenMatches)
      .where(
        and(
          eq(schema.predictionFrozenMatches.predictionId, predictionId),
          eq(schema.predictionFrozenMatches.matchNumber, matchNumber),
        ),
      )
      .get();
    if (existing) continue;

    const fromGroupResults = aggregateFromGroupMatchResults(db, predictionId, matchNumber);
    let aggregated =
      fromGroupResults ?? aggregateLockedMatchFromSimulations(db, predictionId, matchNumber, spec);

    if (!aggregated || aggregated.outcomes.total === 0) {
      const source = readDefaultFrozenRow(db, matchNumber);
      if (!source || source.total === 0) continue;
      aggregated = {
        outcomes: {
          homeWin: source.homeWin,
          draw: source.draw,
          awayWin: source.awayWin,
          total: source.total,
        },
        scorelines: JSON.parse(source.scorelinesJson) as PredictionMatchScorelineCount[],
      };
      const sourceSample =
        source.sampleGoalsHome != null && source.sampleGoalsAway != null
          ? { goalsHome: source.sampleGoalsHome, goalsAway: source.sampleGoalsAway }
          : null;
      const { consensusMode, sampleGoals } = resolveFrozenConsensusForBackfill(
        db,
        matchNumber,
        parseConsensusMode(source.consensusMode),
        sourceSample,
      );
      writeFrozenMatch(
        db,
        predictionId,
        matchNumber,
        aggregated.outcomes,
        aggregated.scorelines,
        recordedAt,
        consensusMode,
        sampleGoals,
      );
      continue;
    }

    const consensusMode = readPredictionConsensusMode(db, predictionId);
    const sampleGoals = sampleGoalsForFreeze(db, predictionId, matchNumber, consensusMode, recordedAt);
    writeFrozenMatch(
      db,
      predictionId,
      matchNumber,
      aggregated.outcomes,
      aggregated.scorelines,
      recordedAt,
      consensusMode,
      sampleGoals,
    );
  }
}

/** Keep locked sample scores aligned with the canonical Default prediction. */
export function syncCanonicalLockedSampleGoalsFromDefault(
  db: Db,
  predictionId: number,
  defaultPredictionId = CANONICAL_FROZEN_PREDICTION_ID,
): void {
  if (predictionId === defaultPredictionId) return;

  const defaultFrozen = readFrozenMatchDistributions(db, defaultPredictionId);
  const locked = readLockedMatchNumbers(db);

  for (const matchNumber of locked) {
    const defaultSample = defaultFrozen.sampleGoalsByMatch.get(matchNumber);
    if (!defaultSample) continue;
    if (defaultFrozen.consensusModesByMatch.get(matchNumber) !== 'sample') continue;

    const ownRow = db
      .select()
      .from(schema.predictionFrozenMatches)
      .where(
        and(
          eq(schema.predictionFrozenMatches.predictionId, predictionId),
          eq(schema.predictionFrozenMatches.matchNumber, matchNumber),
        ),
      )
      .get();
    if (!ownRow) continue;

    if (
      ownRow.sampleGoalsHome === defaultSample.goalsHome &&
      ownRow.sampleGoalsAway === defaultSample.goalsAway &&
      parseConsensusMode(ownRow.consensusMode) === 'sample'
    ) {
      continue;
    }

    db.update(schema.predictionFrozenMatches)
      .set({
        consensusMode: 'sample',
        sampleGoalsHome: defaultSample.goalsHome,
        sampleGoalsAway: defaultSample.goalsAway,
      })
      .where(
        and(
          eq(schema.predictionFrozenMatches.predictionId, predictionId),
          eq(schema.predictionFrozenMatches.matchNumber, matchNumber),
        ),
      )
      .run();

    upsertPredictionSampleResult(
      db,
      predictionId,
      matchNumber,
      defaultSample.goalsHome,
      defaultSample.goalsAway,
      ownRow.frozenAt,
    );
  }
}

/**
 * Repair locked rows that copied Default floor stats but should use the canonical
 * sample score stored on the actual result (post-lock prediction pools).
 */
export function applyCanonicalLockedConsensusFromActuals(
  db: Db,
  predictionId: number,
  defaultPredictionId = CANONICAL_FROZEN_PREDICTION_ID,
): void {
  if (predictionId === defaultPredictionId) return;

  const locked = readLockedMatchNumbers(db);

  for (const matchNumber of locked) {
    const actualSample = readLockedSampleFromActual(db, matchNumber);
    if (!actualSample) continue;

    const ownRow = db
      .select()
      .from(schema.predictionFrozenMatches)
      .where(
        and(
          eq(schema.predictionFrozenMatches.predictionId, predictionId),
          eq(schema.predictionFrozenMatches.matchNumber, matchNumber),
        ),
      )
      .get();
    if (!ownRow) continue;

    const defaultRow = readDefaultFrozenRow(db, matchNumber, defaultPredictionId);
    if (!defaultRow || ownRow.total !== defaultRow.total) continue;

    const ownMode = parseConsensusMode(ownRow.consensusMode);
    const needsMode = ownMode !== 'sample';
    const needsSample =
      ownRow.sampleGoalsHome !== actualSample.goalsHome ||
      ownRow.sampleGoalsAway !== actualSample.goalsAway;
    if (!needsMode && !needsSample) continue;

    db.update(schema.predictionFrozenMatches)
      .set({
        consensusMode: 'sample',
        sampleGoalsHome: actualSample.goalsHome,
        sampleGoalsAway: actualSample.goalsAway,
      })
      .where(
        and(
          eq(schema.predictionFrozenMatches.predictionId, predictionId),
          eq(schema.predictionFrozenMatches.matchNumber, matchNumber),
        ),
      )
      .run();

    upsertPredictionSampleResult(
      db,
      predictionId,
      matchNumber,
      actualSample.goalsHome,
      actualSample.goalsAway,
      ownRow.frozenAt,
    );
  }
}

/** @deprecated Use syncCanonicalLockedSampleGoalsFromDefault */
export function copyMissingFrozenSampleGoalsFromDefault(
  db: Db,
  predictionId: number,
  defaultPredictionId = CANONICAL_FROZEN_PREDICTION_ID,
): void {
  syncCanonicalLockedSampleGoalsFromDefault(db, predictionId, defaultPredictionId);
}

/** Copy Default frozen rows into a prediction for locked group matches that are still missing. */
export function copyMissingFrozenMatchesFromDefault(
  db: Db,
  predictionId: number,
  defaultPredictionId = CANONICAL_FROZEN_PREDICTION_ID,
): void {
  if (predictionId === defaultPredictionId) return;

  const sourceRows = db
    .select()
    .from(schema.predictionFrozenMatches)
    .where(eq(schema.predictionFrozenMatches.predictionId, defaultPredictionId))
    .all();

  for (const source of sourceRows) {
    const fixture = db
      .select({ group: schema.fixtures.group })
      .from(schema.fixtures)
      .where(eq(schema.fixtures.matchNumber, source.matchNumber))
      .get();
    if (fixture?.group == null) continue;

    const existing = db
      .select({ total: schema.predictionFrozenMatches.total })
      .from(schema.predictionFrozenMatches)
      .where(
        and(
          eq(schema.predictionFrozenMatches.predictionId, predictionId),
          eq(schema.predictionFrozenMatches.matchNumber, source.matchNumber),
        ),
      )
      .get();
    if (existing && existing.total > 0) continue;

    const scorelines = JSON.parse(source.scorelinesJson) as PredictionMatchScorelineCount[];
    const sourceSample =
      source.sampleGoalsHome != null && source.sampleGoalsAway != null
        ? { goalsHome: source.sampleGoalsHome, goalsAway: source.sampleGoalsAway }
        : null;
    const { consensusMode, sampleGoals } = resolveFrozenConsensusForBackfill(
      db,
      source.matchNumber,
      parseConsensusMode(source.consensusMode),
      sourceSample,
    );
    upsertFrozenMatch(
      db,
      predictionId,
      source.matchNumber,
      {
        homeWin: source.homeWin,
        draw: source.draw,
        awayWin: source.awayWin,
        total: source.total,
      },
      scorelines,
      source.frozenAt,
      consensusMode,
      sampleGoals,
    );
  }
}

export function copyCanonicalFrozenMatchesFromDefault(
  db: Db,
  defaultPredictionId = CANONICAL_FROZEN_PREDICTION_ID,
): void {
  const sourceRows = db
    .select()
    .from(schema.predictionFrozenMatches)
    .where(eq(schema.predictionFrozenMatches.predictionId, defaultPredictionId))
    .all();

  if (sourceRows.length === 0) return;

  const predictions = db.select({ id: schema.predictions.id }).from(schema.predictions).all();

  for (const source of sourceRows) {
    const fixture = db
      .select({ group: schema.fixtures.group })
      .from(schema.fixtures)
      .where(eq(schema.fixtures.matchNumber, source.matchNumber))
      .get();
    if (fixture?.group == null) continue;

    const scorelines = JSON.parse(source.scorelinesJson) as PredictionMatchScorelineCount[];
    const outcomes: PredictionMatchOutcomeCounts = {
      homeWin: source.homeWin,
      draw: source.draw,
      awayWin: source.awayWin,
      total: source.total,
    };
    const sourceSample =
      source.sampleGoalsHome != null && source.sampleGoalsAway != null
        ? { goalsHome: source.sampleGoalsHome, goalsAway: source.sampleGoalsAway }
        : null;

    for (const prediction of predictions) {
      upsertFrozenMatch(
        db,
        prediction.id,
        source.matchNumber,
        outcomes,
        scorelines,
        source.frozenAt,
        parseConsensusMode(source.consensusMode),
        sourceSample,
      );
    }
  }
}

export function setFrozenMatchConsensusMode(
  db: Db,
  predictionId: number,
  matchNumber: number,
  consensusMode: ConsensusMode,
): void {
  if (!readLockedMatchNumbers(db).has(matchNumber)) {
    throw new Error(`Match ${matchNumber} is not locked by an actual result`);
  }

  const fixture = db
    .select({ group: schema.fixtures.group })
    .from(schema.fixtures)
    .where(eq(schema.fixtures.matchNumber, matchNumber))
    .get();
  if (fixture?.group == null) {
    throw new Error(`Match ${matchNumber} is not a group-stage fixture`);
  }

  const mode = parseConsensusMode(consensusMode);
  const existing = db
    .select()
    .from(schema.predictionFrozenMatches)
    .where(
      and(
        eq(schema.predictionFrozenMatches.predictionId, predictionId),
        eq(schema.predictionFrozenMatches.matchNumber, matchNumber),
      ),
    )
    .get();

  if (existing) {
    const recordedAt =
      db
        .select({ recordedAt: schema.actualMatchResults.recordedAt })
        .from(schema.actualMatchResults)
        .where(eq(schema.actualMatchResults.matchNumber, matchNumber))
        .get()?.recordedAt ?? existing.frozenAt;
    const sampleGoals =
      mode === 'sample' && (existing.sampleGoalsHome == null || existing.sampleGoalsAway == null)
        ? sampleGoalsForFreeze(db, predictionId, matchNumber, mode, recordedAt)
        : existing.sampleGoalsHome != null && existing.sampleGoalsAway != null
          ? { goalsHome: existing.sampleGoalsHome, goalsAway: existing.sampleGoalsAway }
          : null;

    db.update(schema.predictionFrozenMatches)
      .set({
        consensusMode: mode,
        ...(mode === 'sample' && sampleGoals
          ? {
              sampleGoalsHome: sampleGoals.goalsHome,
              sampleGoalsAway: sampleGoals.goalsAway,
            }
          : {}),
      })
      .where(
        and(
          eq(schema.predictionFrozenMatches.predictionId, predictionId),
          eq(schema.predictionFrozenMatches.matchNumber, matchNumber),
        ),
      )
      .run();
    return;
  }

  const effective = readEffectiveFrozenMatchDistributions(db, predictionId);
  const outcomes = effective.outcomesByMatch.get(matchNumber);
  if (!outcomes || outcomes.total === 0) {
    throw new Error(`No frozen prediction data for match ${matchNumber}`);
  }

  const scorelines = effective.scorelinesByMatch.get(matchNumber) ?? [];
  const recordedAt =
    db
      .select({ recordedAt: schema.actualMatchResults.recordedAt })
      .from(schema.actualMatchResults)
      .where(eq(schema.actualMatchResults.matchNumber, matchNumber))
      .get()?.recordedAt ?? new Date().toISOString();

  const sampleGoals =
    mode === 'sample'
      ? (effective.sampleGoalsByMatch.get(matchNumber) ??
        sampleGoalsForFreeze(db, predictionId, matchNumber, mode, recordedAt))
      : null;

  upsertFrozenMatch(
    db,
    predictionId,
    matchNumber,
    outcomes,
    scorelines,
    recordedAt,
    mode,
    sampleGoals,
  );
}

/** Backfill locked sample predictions for frozen rows created before sample locking existed. */
export function backfillFrozenSampleGoals(db: Db): void {
  const rows = db
    .select()
    .from(schema.predictionFrozenMatches)
    .where(eq(schema.predictionFrozenMatches.consensusMode, 'sample'))
    .all();

  for (const row of rows) {
    if (row.sampleGoalsHome != null && row.sampleGoalsAway != null) continue;

    const fromSample = resolveSampleGoalsForFreeze(db, row.predictionId, row.matchNumber);
    const fromDefault =
      row.predictionId !== CANONICAL_FROZEN_PREDICTION_ID
        ? readDefaultFrozenRow(db, row.matchNumber, CANONICAL_FROZEN_PREDICTION_ID)
        : null;
    const defaultSample =
      fromDefault?.sampleGoalsHome != null && fromDefault?.sampleGoalsAway != null
        ? { goalsHome: fromDefault.sampleGoalsHome, goalsAway: fromDefault.sampleGoalsAway }
        : null;
    const sampleGoals = fromSample ?? defaultSample;
    if (!sampleGoals) continue;

    db.update(schema.predictionFrozenMatches)
      .set({
        sampleGoalsHome: sampleGoals.goalsHome,
        sampleGoalsAway: sampleGoals.goalsAway,
      })
      .where(
        and(
          eq(schema.predictionFrozenMatches.predictionId, row.predictionId),
          eq(schema.predictionFrozenMatches.matchNumber, row.matchNumber),
        ),
      )
      .run();

    upsertPredictionSampleResult(
      db,
      row.predictionId,
      row.matchNumber,
      sampleGoals.goalsHome,
      sampleGoals.goalsAway,
      row.frozenAt,
    );
  }
}

/** Snapshot predictions for locked sample-mode matches entered before sample locking shipped. */
const KNOWN_LOCKED_SAMPLE_GOALS = new Map<number, { goalsHome: number; goalsAway: number }>([
  [49, { goalsHome: 1, goalsAway: 0 }],
  [50, { goalsHome: 0, goalsAway: 2 }],
  [55, { goalsHome: 2, goalsAway: 0 }],
  [56, { goalsHome: 2, goalsAway: 0 }],
  [61, { goalsHome: 4, goalsAway: 1 }],
  [67, { goalsHome: 2, goalsAway: 1 }],
]);

export function applyKnownLockedSampleGoals(db: Db): void {
  for (const [matchNumber, goals] of KNOWN_LOCKED_SAMPLE_GOALS) {
    const actual = db
      .select({ matchNumber: schema.actualMatchResults.matchNumber })
      .from(schema.actualMatchResults)
      .where(eq(schema.actualMatchResults.matchNumber, matchNumber))
      .get();
    if (actual) {
      db.update(schema.actualMatchResults)
        .set({
          predictedGoalsHome: goals.goalsHome,
          predictedGoalsAway: goals.goalsAway,
        })
        .where(eq(schema.actualMatchResults.matchNumber, matchNumber))
        .run();
    }

    const rows = db
      .select()
      .from(schema.predictionFrozenMatches)
      .where(eq(schema.predictionFrozenMatches.matchNumber, matchNumber))
      .all();

    for (const row of rows) {
      db.update(schema.predictionFrozenMatches)
        .set({
          consensusMode: 'sample',
          sampleGoalsHome: goals.goalsHome,
          sampleGoalsAway: goals.goalsAway,
        })
        .where(
          and(
            eq(schema.predictionFrozenMatches.predictionId, row.predictionId),
            eq(schema.predictionFrozenMatches.matchNumber, matchNumber),
          ),
        )
        .run();
      upsertPredictionSampleResult(
        db,
        row.predictionId,
        matchNumber,
        goals.goalsHome,
        goals.goalsAway,
        row.frozenAt,
      );
    }
  }
}

export function clearFrozenMatch(db: Db, matchNumber: number): void {
  db.delete(schema.predictionFrozenMatches)
    .where(eq(schema.predictionFrozenMatches.matchNumber, matchNumber))
    .run();
  db.delete(schema.predictionGroupMatchResults)
    .where(eq(schema.predictionGroupMatchResults.matchNumber, matchNumber))
    .run();
}

export function migrateExistingFrozenMatches(db: Db): void {
  const defaultPrediction = db
    .select({
      id: schema.predictions.id,
      selectionSpec: schema.predictions.selectionSpec,
    })
    .from(schema.predictions)
    .where(eq(schema.predictions.id, CANONICAL_FROZEN_PREDICTION_ID))
    .get();

  if (defaultPrediction) {
    const defaultSpec = JSON.parse(defaultPrediction.selectionSpec) as SelectionSpec;
    backfillFrozenMatchesForPrediction(db, defaultPrediction.id, defaultSpec);
    copyCanonicalFrozenMatchesFromDefault(db, defaultPrediction.id);
    return;
  }

  const locked = db
    .select({ matchNumber: schema.actualMatchResults.matchNumber, recordedAt: schema.actualMatchResults.recordedAt })
    .from(schema.actualMatchResults)
    .all();

  for (const { matchNumber, recordedAt } of locked) {
    const fixture = db
      .select({ group: schema.fixtures.group })
      .from(schema.fixtures)
      .where(eq(schema.fixtures.matchNumber, matchNumber))
      .get();
    if (fixture?.group == null) continue;

    freezeMatchForAllPredictions(db, matchNumber, recordedAt);
  }

  const predictions = db
    .select({
      id: schema.predictions.id,
      selectionSpec: schema.predictions.selectionSpec,
    })
    .from(schema.predictions)
    .all();

  for (const prediction of predictions) {
    const spec = JSON.parse(prediction.selectionSpec) as SelectionSpec;
    backfillFrozenMatchesForPrediction(db, prediction.id, spec);
  }
}
