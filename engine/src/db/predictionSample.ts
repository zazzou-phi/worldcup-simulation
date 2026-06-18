import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as schema from './schema.js';

export class PredictionSampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PredictionSampleError';
  }
}

export interface PredictionSampleResultRow {
  goalsHome: number;
  goalsAway: number;
  sampledAt: string;
}

export interface PredictionSampleSummary {
  sampledAt: string;
  matchCount: number;
}

function getSqlite(db: Db): import('better-sqlite3').Database {
  const sqlite = (db as { $client?: import('better-sqlite3').Database }).$client;
  if (!sqlite) {
    throw new Error('SQLite client unavailable');
  }
  return sqlite;
}

export function readPredictionSampleResults(
  db: Db,
  predictionId: number,
): Map<number, PredictionSampleResultRow> {
  const rows = db
    .select()
    .from(schema.predictionSampleResults)
    .where(eq(schema.predictionSampleResults.predictionId, predictionId))
    .all();

  const results = new Map<number, PredictionSampleResultRow>();
  for (const row of rows) {
    results.set(row.matchNumber, {
      goalsHome: row.goalsHome,
      goalsAway: row.goalsAway,
      sampledAt: row.sampledAt,
    });
  }
  return results;
}

export function readPredictionSampleSummary(
  db: Db,
  predictionId: number,
): PredictionSampleSummary | null {
  const rows = db
    .select({ sampledAt: schema.predictionSampleResults.sampledAt })
    .from(schema.predictionSampleResults)
    .where(eq(schema.predictionSampleResults.predictionId, predictionId))
    .limit(1)
    .all();
  if (rows.length === 0) return null;

  const countRow = getSqlite(db)
    .prepare('SELECT COUNT(*) AS n FROM prediction_sample_results WHERE prediction_id = ?')
    .get(predictionId) as { n: number };

  return {
    sampledAt: rows[0]!.sampledAt,
    matchCount: countRow.n,
  };
}

export function deletePredictionSampleResults(db: Db, predictionId: number): void {
  db.delete(schema.predictionSampleResults)
    .where(eq(schema.predictionSampleResults.predictionId, predictionId))
    .run();
}

/** Pick one pool scoreline for a fixture (same source as sampling). */
export function pickSampleGoalsFromPool(
  db: Db,
  predictionId: number,
  matchNumber: number,
): { goalsHome: number; goalsAway: number } | null {
  const sqlite = getSqlite(db);
  const sample = sqlite
    .prepare(
      `SELECT goals_home AS goalsHome, goals_away AS goalsAway
       FROM prediction_group_match_results
       WHERE prediction_id = ? AND match_number = ?
       ORDER BY RANDOM()
       LIMIT 1`,
    )
    .get(predictionId, matchNumber) as { goalsHome: number; goalsAway: number } | undefined;
  return sample ?? null;
}

/** Resolve the sample scoreline to freeze when an actual result is entered. */
export function resolveSampleGoalsForFreeze(
  db: Db,
  predictionId: number,
  matchNumber: number,
): { goalsHome: number; goalsAway: number } | null {
  const existing = readPredictionSampleResults(db, predictionId).get(matchNumber);
  if (existing) {
    return { goalsHome: existing.goalsHome, goalsAway: existing.goalsAway };
  }
  return pickSampleGoalsFromPool(db, predictionId, matchNumber);
}

export function upsertPredictionSampleResult(
  db: Db,
  predictionId: number,
  matchNumber: number,
  goalsHome: number,
  goalsAway: number,
  sampledAt: string,
): void {
  const sqlite = getSqlite(db);
  sqlite
    .prepare(
      `INSERT INTO prediction_sample_results (
         prediction_id, match_number, goals_home, goals_away, sampled_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(prediction_id, match_number) DO UPDATE SET
         goals_home = excluded.goals_home,
         goals_away = excluded.goals_away,
         sampled_at = excluded.sampled_at`,
    )
    .run(predictionId, matchNumber, goalsHome, goalsAway, sampledAt);
}

export function performPredictionSample(db: Db, predictionId: number): PredictionSampleSummary {
  const sqlite = getSqlite(db);
  const eligibleMatches = sqlite
    .prepare(
      `SELECT DISTINCT pgmr.match_number AS matchNumber
       FROM prediction_group_match_results pgmr
       INNER JOIN fixtures f ON f.match_number = pgmr.match_number
       LEFT JOIN actual_match_results amr ON amr.match_number = pgmr.match_number
       WHERE pgmr.prediction_id = ?
         AND f."group" IS NOT NULL
         AND amr.match_number IS NULL
       ORDER BY pgmr.match_number`,
    )
    .all(predictionId) as Array<{ matchNumber: number }>;

  if (eligibleMatches.length === 0) {
    throw new PredictionSampleError('No unlocked group fixtures with simulation data to sample');
  }

  const sampledAt = new Date().toISOString();
  const sampleStmt = sqlite.prepare(
    `SELECT goals_home AS goalsHome, goals_away AS goalsAway
     FROM prediction_group_match_results
     WHERE prediction_id = ? AND match_number = ?
     ORDER BY RANDOM()
     LIMIT 1`,
  );
  const insertStmt = sqlite.prepare(
    `INSERT INTO prediction_sample_results (
       prediction_id, match_number, goals_home, goals_away, sampled_at
     ) VALUES (?, ?, ?, ?, ?)`,
  );

  const sampleTransaction = sqlite.transaction((matches: Array<{ matchNumber: number }>) => {
    sqlite
      .prepare(
        `DELETE FROM prediction_sample_results
         WHERE prediction_id = ?
           AND match_number NOT IN (
             SELECT match_number FROM actual_match_results
           )`,
      )
      .run(predictionId);

    for (const match of matches) {
      const sample = sampleStmt.get(predictionId, match.matchNumber) as
        | { goalsHome: number; goalsAway: number }
        | undefined;
      if (!sample) continue;
      insertStmt.run(
        predictionId,
        match.matchNumber,
        sample.goalsHome,
        sample.goalsAway,
        sampledAt,
      );
    }
  });

  sampleTransaction(eligibleMatches);

  return { sampledAt, matchCount: eligibleMatches.length };
}
