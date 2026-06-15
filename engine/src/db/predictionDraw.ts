import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as schema from './schema.js';

export class PredictionDrawError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PredictionDrawError';
  }
}

export interface PredictionDrawResultRow {
  goalsHome: number;
  goalsAway: number;
  drawnAt: string;
}

export interface PredictionDrawSummary {
  drawnAt: string;
  matchCount: number;
}

function getSqlite(db: Db): import('better-sqlite3').Database {
  const sqlite = (db as { $client?: import('better-sqlite3').Database }).$client;
  if (!sqlite) {
    throw new Error('SQLite client unavailable');
  }
  return sqlite;
}

export function readPredictionDrawResults(
  db: Db,
  predictionId: number,
): Map<number, PredictionDrawResultRow> {
  const rows = db
    .select()
    .from(schema.predictionDrawResults)
    .where(eq(schema.predictionDrawResults.predictionId, predictionId))
    .all();

  const results = new Map<number, PredictionDrawResultRow>();
  for (const row of rows) {
    results.set(row.matchNumber, {
      goalsHome: row.goalsHome,
      goalsAway: row.goalsAway,
      drawnAt: row.drawnAt,
    });
  }
  return results;
}

export function readPredictionDrawSummary(
  db: Db,
  predictionId: number,
): PredictionDrawSummary | null {
  const rows = db
    .select({ drawnAt: schema.predictionDrawResults.drawnAt })
    .from(schema.predictionDrawResults)
    .where(eq(schema.predictionDrawResults.predictionId, predictionId))
    .limit(1)
    .all();
  if (rows.length === 0) return null;

  const countRow = getSqlite(db)
    .prepare('SELECT COUNT(*) AS n FROM prediction_draw_results WHERE prediction_id = ?')
    .get(predictionId) as { n: number };

  return {
    drawnAt: rows[0]!.drawnAt,
    matchCount: countRow.n,
  };
}

export function deletePredictionDrawResults(db: Db, predictionId: number): void {
  db.delete(schema.predictionDrawResults)
    .where(eq(schema.predictionDrawResults.predictionId, predictionId))
    .run();
}

export function performPredictionDraw(db: Db, predictionId: number): PredictionDrawSummary {
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
    throw new PredictionDrawError('No unlocked group fixtures with simulation data to draw');
  }

  const drawnAt = new Date().toISOString();
  const sampleStmt = sqlite.prepare(
    `SELECT goals_home AS goalsHome, goals_away AS goalsAway
     FROM prediction_group_match_results
     WHERE prediction_id = ? AND match_number = ?
     ORDER BY RANDOM()
     LIMIT 1`,
  );
  const insertStmt = sqlite.prepare(
    `INSERT INTO prediction_draw_results (
       prediction_id, match_number, goals_home, goals_away, drawn_at
     ) VALUES (?, ?, ?, ?, ?)`,
  );

  const drawTransaction = sqlite.transaction((matches: Array<{ matchNumber: number }>) => {
    sqlite
      .prepare('DELETE FROM prediction_draw_results WHERE prediction_id = ?')
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
        drawnAt,
      );
    }
  });

  drawTransaction(eligibleMatches);

  return { drawnAt, matchCount: eligibleMatches.length };
}
