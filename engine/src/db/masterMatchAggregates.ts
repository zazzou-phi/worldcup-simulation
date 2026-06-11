import type Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as schema from './schema.js';

export interface MasterMatchOutcomeCounts {
  homeWin: number;
  draw: number;
  awayWin: number;
  total: number;
}

export interface MasterMatchScorelineCount {
  goalsHome: number;
  goalsAway: number;
  n: number;
}

function getSqlite(db: Db): Database.Database {
  const client = (db as { $client?: Database.Database }).$client;
  if (!client) {
    throw new Error('SQLite client required for master match aggregate rebuild');
  }
  return client;
}

function outcomeDeltas(
  goalsHome: number,
  goalsAway: number,
): Pick<MasterMatchOutcomeCounts, 'homeWin' | 'draw' | 'awayWin'> & { total: number } {
  if (goalsHome > goalsAway) {
    return { homeWin: 1, draw: 0, awayWin: 0, total: 1 };
  }
  if (goalsHome < goalsAway) {
    return { homeWin: 0, draw: 0, awayWin: 1, total: 1 };
  }
  return { homeWin: 0, draw: 1, awayWin: 0, total: 1 };
}

function adjustMasterMatchOutcome(
  db: Db,
  matchNumber: number,
  goalsHome: number,
  goalsAway: number,
  direction: 1 | -1,
): void {
  const delta = outcomeDeltas(goalsHome, goalsAway);
  const existing = db
    .select()
    .from(schema.masterMatchOutcomes)
    .where(eq(schema.masterMatchOutcomes.matchNumber, matchNumber))
    .get();

  const homeWin = (existing?.homeWin ?? 0) + delta.homeWin * direction;
  const draw = (existing?.draw ?? 0) + delta.draw * direction;
  const awayWin = (existing?.awayWin ?? 0) + delta.awayWin * direction;
  const total = (existing?.total ?? 0) + delta.total * direction;

  if (total <= 0) {
    if (existing) {
      db.delete(schema.masterMatchOutcomes)
        .where(eq(schema.masterMatchOutcomes.matchNumber, matchNumber))
        .run();
    }
    return;
  }

  if (existing) {
    db.update(schema.masterMatchOutcomes)
      .set({ homeWin, draw, awayWin, total })
      .where(eq(schema.masterMatchOutcomes.matchNumber, matchNumber))
      .run();
  } else {
    db.insert(schema.masterMatchOutcomes)
      .values({ matchNumber, homeWin, draw, awayWin, total })
      .run();
  }
}

function adjustMasterMatchScoreline(
  db: Db,
  matchNumber: number,
  goalsHome: number,
  goalsAway: number,
  direction: 1 | -1,
): void {
  const existing = db
    .select()
    .from(schema.masterMatchScorelines)
    .where(
      and(
        eq(schema.masterMatchScorelines.matchNumber, matchNumber),
        eq(schema.masterMatchScorelines.goalsHome, goalsHome),
        eq(schema.masterMatchScorelines.goalsAway, goalsAway),
      ),
    )
    .get();

  const count = (existing?.count ?? 0) + direction;

  if (count <= 0) {
    if (existing) {
      db.delete(schema.masterMatchScorelines)
        .where(
          and(
            eq(schema.masterMatchScorelines.matchNumber, matchNumber),
            eq(schema.masterMatchScorelines.goalsHome, goalsHome),
            eq(schema.masterMatchScorelines.goalsAway, goalsAway),
          ),
        )
        .run();
    }
    return;
  }

  if (existing) {
    db.update(schema.masterMatchScorelines)
      .set({ count })
      .where(
        and(
          eq(schema.masterMatchScorelines.matchNumber, matchNumber),
          eq(schema.masterMatchScorelines.goalsHome, goalsHome),
          eq(schema.masterMatchScorelines.goalsAway, goalsAway),
        ),
      )
      .run();
  } else {
    db.insert(schema.masterMatchScorelines)
      .values({ matchNumber, goalsHome, goalsAway, count })
      .run();
  }
}

function applyGroupMatchResult(
  db: Db,
  matchNumber: number,
  goalsHome: number,
  goalsAway: number,
  direction: 1 | -1,
): void {
  adjustMasterMatchOutcome(db, matchNumber, goalsHome, goalsAway, direction);
  adjustMasterMatchScoreline(db, matchNumber, goalsHome, goalsAway, direction);
}

function readSimulationGroupMatchResults(
  db: Db,
  simulationId: number,
): Map<number, { goalsHome: number; goalsAway: number }> {
  const rows = db
    .select()
    .from(schema.simulationGroupMatchResults)
    .where(eq(schema.simulationGroupMatchResults.simulationId, simulationId))
    .all();

  return new Map(
    rows.map((row) => [row.matchNumber, { goalsHome: row.goalsHome, goalsAway: row.goalsAway }]),
  );
}

function readCurrentGroupMatchResults(
  db: Db,
  simulationId: number,
): Map<number, { goalsHome: number; goalsAway: number }> {
  const sqlite = getSqlite(db);
  const rows = sqlite
    .prepare(
      `SELECT sm.match_number AS matchNumber, sm.goals_home AS goalsHome, sm.goals_away AS goalsAway
       FROM simulation_matches sm
       INNER JOIN fixtures f ON f.match_number = sm.match_number
       WHERE sm.simulation_id = ?
         AND f."group" IS NOT NULL
         AND sm.status = 'played'
         AND sm.goals_home IS NOT NULL
         AND sm.goals_away IS NOT NULL`,
    )
    .all(simulationId) as Array<{ matchNumber: number; goalsHome: number; goalsAway: number }>;

  return new Map(rows.map((row) => [row.matchNumber, { goalsHome: row.goalsHome, goalsAway: row.goalsAway }]));
}

export function refreshSimulationGroupMatchAggregates(db: Db, simulationId: number): void {
  const oldResults = readSimulationGroupMatchResults(db, simulationId);
  const newResults = readCurrentGroupMatchResults(db, simulationId);
  const affectedMatchNumbers = new Set([...oldResults.keys(), ...newResults.keys()]);

  for (const matchNumber of affectedMatchNumbers) {
    const oldResult = oldResults.get(matchNumber);
    const newResult = newResults.get(matchNumber);

    if (
      oldResult &&
      newResult &&
      oldResult.goalsHome === newResult.goalsHome &&
      oldResult.goalsAway === newResult.goalsAway
    ) {
      continue;
    }

    if (oldResult) {
      applyGroupMatchResult(db, matchNumber, oldResult.goalsHome, oldResult.goalsAway, -1);
    }
    if (newResult) {
      applyGroupMatchResult(db, matchNumber, newResult.goalsHome, newResult.goalsAway, 1);
    }
  }

  db.delete(schema.simulationGroupMatchResults)
    .where(eq(schema.simulationGroupMatchResults.simulationId, simulationId))
    .run();

  for (const [matchNumber, result] of newResults) {
    db.insert(schema.simulationGroupMatchResults)
      .values({
        simulationId,
        matchNumber,
        goalsHome: result.goalsHome,
        goalsAway: result.goalsAway,
      })
      .run();
  }
}

export function removeSimulationFromMasterMatchAggregates(db: Db, simulationId: number): void {
  const oldResults = readSimulationGroupMatchResults(db, simulationId);
  for (const [matchNumber, result] of oldResults) {
    applyGroupMatchResult(db, matchNumber, result.goalsHome, result.goalsAway, -1);
  }
  db.delete(schema.simulationGroupMatchResults)
    .where(eq(schema.simulationGroupMatchResults.simulationId, simulationId))
    .run();
}

export function rebuildAllMasterMatchAggregates(db: Db): void {
  getSqlite(db).exec(`
    DELETE FROM simulation_group_match_results;
    DELETE FROM master_match_scorelines;
    DELETE FROM master_match_outcomes;

    INSERT INTO master_match_outcomes (match_number, home_win, draw, away_win, total)
    SELECT
      sm.match_number,
      sum(CASE WHEN sm.goals_home > sm.goals_away THEN 1 ELSE 0 END),
      sum(CASE WHEN sm.goals_home = sm.goals_away THEN 1 ELSE 0 END),
      sum(CASE WHEN sm.goals_home < sm.goals_away THEN 1 ELSE 0 END),
      count(*)
    FROM simulation_matches sm
    INNER JOIN fixtures f ON f.match_number = sm.match_number
    WHERE f."group" IS NOT NULL
      AND sm.status = 'played'
      AND sm.goals_home IS NOT NULL
      AND sm.goals_away IS NOT NULL
    GROUP BY sm.match_number;

    INSERT INTO master_match_scorelines (match_number, goals_home, goals_away, count)
    SELECT sm.match_number, sm.goals_home, sm.goals_away, count(*)
    FROM simulation_matches sm
    INNER JOIN fixtures f ON f.match_number = sm.match_number
    WHERE f."group" IS NOT NULL
      AND sm.status = 'played'
      AND sm.goals_home IS NOT NULL
      AND sm.goals_away IS NOT NULL
    GROUP BY sm.match_number, sm.goals_home, sm.goals_away;

    INSERT INTO simulation_group_match_results (simulation_id, match_number, goals_home, goals_away)
    SELECT sm.simulation_id, sm.match_number, sm.goals_home, sm.goals_away
    FROM simulation_matches sm
    INNER JOIN fixtures f ON f.match_number = sm.match_number
    WHERE f."group" IS NOT NULL
      AND sm.status = 'played'
      AND sm.goals_home IS NOT NULL
      AND sm.goals_away IS NOT NULL;
  `);
}

export function readMasterMatchDistributions(db: Db): {
  outcomesByMatch: Map<number, MasterMatchOutcomeCounts>;
  scorelinesByMatch: Map<number, MasterMatchScorelineCount[]>;
} {
  const outcomeRows = db.select().from(schema.masterMatchOutcomes).all();
  const scorelineRows = db.select().from(schema.masterMatchScorelines).all();

  const outcomesByMatch = new Map(
    outcomeRows.map((row) => [
      row.matchNumber,
      {
        homeWin: row.homeWin,
        draw: row.draw,
        awayWin: row.awayWin,
        total: row.total,
      },
    ]),
  );

  const scorelinesByMatch = new Map<number, MasterMatchScorelineCount[]>();
  for (const row of scorelineRows) {
    const list = scorelinesByMatch.get(row.matchNumber) ?? [];
    list.push({ goalsHome: row.goalsHome, goalsAway: row.goalsAway, n: row.count });
    scorelinesByMatch.set(row.matchNumber, list);
  }

  return { outcomesByMatch, scorelinesByMatch };
}
