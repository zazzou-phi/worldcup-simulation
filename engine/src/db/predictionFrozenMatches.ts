import { and, eq } from 'drizzle-orm';
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
  type SelectionSpec,
} from '../lib/simulationSelection.js';
import { parseConsensusMode, type ConsensusMode } from '../engine/consensus.js';

export interface FrozenMatchDistribution {
  outcomes: PredictionMatchOutcomeCounts;
  scorelines: PredictionMatchScorelineCount[];
  frozenAt: string;
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

function writeFrozenMatch(
  db: Db,
  predictionId: number,
  matchNumber: number,
  outcomes: PredictionMatchOutcomeCounts,
  scorelines: PredictionMatchScorelineCount[],
  frozenAt: string,
  consensusMode: ConsensusMode,
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
  for (const row of rows) {
    scorelinesByMatch.set(row.matchNumber, JSON.parse(row.scorelinesJson) as PredictionMatchScorelineCount[]);
    consensusModesByMatch.set(row.matchNumber, parseConsensusMode(row.consensusMode));
  }

  return { outcomesByMatch, scorelinesByMatch, consensusModesByMatch };
}

/** Locked-match frozen rows, falling back to Default when this pool has no pre-result data. */
export function readEffectiveFrozenMatchDistributions(
  db: Db,
  predictionId: number,
  defaultPredictionId = CANONICAL_FROZEN_PREDICTION_ID,
): {
  outcomesByMatch: Map<number, PredictionMatchOutcomeCounts>;
  scorelinesByMatch: Map<number, PredictionMatchScorelineCount[]>;
  consensusModesByMatch: Map<number, ConsensusMode>;
} {
  const own = readFrozenMatchDistributions(db, predictionId);
  if (predictionId === defaultPredictionId) return own;

  const fallback = readFrozenMatchDistributions(db, defaultPredictionId);
  const locked = readLockedMatchNumbers(db);
  const outcomesByMatch = new Map(own.outcomesByMatch);
  const scorelinesByMatch = new Map(own.scorelinesByMatch);
  const consensusModesByMatch = new Map(own.consensusModesByMatch);

  for (const matchNumber of locked) {
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
  }

  return { outcomesByMatch, scorelinesByMatch, consensusModesByMatch };
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

  writeFrozenMatch(db, predictionId, matchNumber, outcomes, scorelines, frozenAt, consensusMode);
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
      writeFrozenMatch(
        db,
        predictionId,
        matchNumber,
        aggregated.outcomes,
        aggregated.scorelines,
        recordedAt,
        parseConsensusMode(source.consensusMode),
      );
      continue;
    }

    writeFrozenMatch(
      db,
      predictionId,
      matchNumber,
      aggregated.outcomes,
      aggregated.scorelines,
      recordedAt,
      readPredictionConsensusMode(db, predictionId),
    );
  }
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
      parseConsensusMode(source.consensusMode),
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

    for (const prediction of predictions) {
      upsertFrozenMatch(
        db,
        prediction.id,
        source.matchNumber,
        outcomes,
        scorelines,
        source.frozenAt,
        parseConsensusMode(source.consensusMode),
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
    db.update(schema.predictionFrozenMatches)
      .set({ consensusMode: mode })
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

  upsertFrozenMatch(db, predictionId, matchNumber, outcomes, scorelines, recordedAt, mode);
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
