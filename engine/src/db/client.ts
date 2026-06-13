import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { rebuildPredictionAggregates } from './predictionAggregates.js';
import { migrateExistingFrozenMatches } from './predictionFrozenMatches.js';
import { computeNormalizedTeamRatings, computeBlendedNormalizedRatings } from '../engine/teamRatings.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import type { SelectionSpec } from '../lib/simulationSelection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getProjectDataDir(): string {
  return join(__dirname, '../../../data');
}

export function getDefaultDbPath(): string {
  return join(getProjectDataDir(), 'simulations.db');
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row != null;
}

export function initSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      country_code TEXT,
      flag TEXT NOT NULL,
      rank INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      elo INTEGER NOT NULL,
      total INTEGER NOT NULL,
      goals_for INTEGER NOT NULL,
      goals_against INTEGER NOT NULL,
      elo_offensive_rating REAL NOT NULL,
      elo_defensive_rating REAL NOT NULL,
      goal_offensive_rating REAL NOT NULL,
      goal_defensive_rating REAL NOT NULL,
      blend_offensive_rating REAL NOT NULL,
      blend_defensive_rating REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY,
      rating_elo_weight REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_memberships (
      group_letter TEXT NOT NULL,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      PRIMARY KEY (group_letter, team_id)
    );
    CREATE TABLE IF NOT EXISTS fixtures (
      match_number INTEGER PRIMARY KEY,
      round TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      venue TEXT NOT NULL,
      "group" TEXT,
      slot_home TEXT NOT NULL,
      slot_away TEXT NOT NULL,
      team_home_id INTEGER REFERENCES teams(id),
      team_away_id INTEGER REFERENCES teams(id)
    );
    CREATE TABLE IF NOT EXISTS simulations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      phase TEXT NOT NULL,
      annex_c_combination_id INTEGER,
      champion_team_id INTEGER REFERENCES teams(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      selection_spec TEXT NOT NULL,
      consensus_mode TEXT NOT NULL DEFAULT 'expected',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prediction_group_match_results (
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      simulation_id INTEGER NOT NULL REFERENCES simulations(id),
      match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
      goals_home INTEGER NOT NULL,
      goals_away INTEGER NOT NULL,
      PRIMARY KEY (prediction_id, simulation_id, match_number)
    );
    CREATE TABLE IF NOT EXISTS prediction_simulation_team_goals (
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      simulation_id INTEGER NOT NULL REFERENCES simulations(id),
      team_id INTEGER NOT NULL REFERENCES teams(id),
      goals INTEGER NOT NULL,
      PRIMARY KEY (prediction_id, simulation_id, team_id)
    );
    CREATE TABLE IF NOT EXISTS prediction_match_outcomes (
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
      home_win INTEGER NOT NULL,
      draw INTEGER NOT NULL,
      away_win INTEGER NOT NULL,
      total INTEGER NOT NULL,
      PRIMARY KEY (prediction_id, match_number)
    );
    CREATE TABLE IF NOT EXISTS prediction_match_scorelines (
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
      goals_home INTEGER NOT NULL,
      goals_away INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (prediction_id, match_number, goals_home, goals_away)
    );
    CREATE TABLE IF NOT EXISTS prediction_team_stats (
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      team_id INTEGER NOT NULL REFERENCES teams(id),
      total_goals INTEGER NOT NULL,
      simulations_with_matches INTEGER NOT NULL,
      champion_wins INTEGER NOT NULL,
      PRIMARY KEY (prediction_id, team_id)
    );
    CREATE TABLE IF NOT EXISTS prediction_frozen_matches (
      prediction_id INTEGER NOT NULL REFERENCES predictions(id),
      match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
      home_win INTEGER NOT NULL,
      draw INTEGER NOT NULL,
      away_win INTEGER NOT NULL,
      total INTEGER NOT NULL,
      scorelines_json TEXT NOT NULL,
      frozen_at TEXT NOT NULL,
      PRIMARY KEY (prediction_id, match_number)
    );
    CREATE TABLE IF NOT EXISTS simulation_matches (
      simulation_id INTEGER NOT NULL REFERENCES simulations(id),
      match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
      team_home_id INTEGER REFERENCES teams(id),
      team_away_id INTEGER REFERENCES teams(id),
      goals_home INTEGER,
      goals_away INTEGER,
      winner_team_id INTEGER REFERENCES teams(id),
      status TEXT NOT NULL,
      PRIMARY KEY (simulation_id, match_number)
    );
    CREATE TABLE IF NOT EXISTS actual_match_results (
      match_number INTEGER PRIMARY KEY REFERENCES fixtures(match_number),
      goals_home INTEGER NOT NULL,
      goals_away INTEGER NOT NULL,
      winner_team_id INTEGER REFERENCES teams(id),
      recorded_at TEXT NOT NULL
    );
  `);
  migrateSchema(sqlite);
}

function migrateSchema(sqlite: Database.Database) {
  const columns = sqlite.prepare('PRAGMA table_info(simulation_matches)').all() as Array<{
    name: string;
  }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('team_home_id')) {
    sqlite.exec(
      'ALTER TABLE simulation_matches ADD COLUMN team_home_id INTEGER REFERENCES teams(id)',
    );
  }
  if (!names.has('team_away_id')) {
    sqlite.exec(
      'ALTER TABLE simulation_matches ADD COLUMN team_away_id INTEGER REFERENCES teams(id)',
    );
  }
  sqlite.exec(`UPDATE simulations SET phase = 'g3' WHERE phase = 'knockout'`);

  const simulationColumns = sqlite.prepare('PRAGMA table_info(simulations)').all() as Array<{
    name: string;
  }>;
  const simulationColumnNames = new Set(simulationColumns.map((column) => column.name));
  if (!simulationColumnNames.has('champion_team_id')) {
    sqlite.exec(
      'ALTER TABLE simulations ADD COLUMN champion_team_id INTEGER REFERENCES teams(id)',
    );
  }

  migrateTeamsElo(sqlite);
  migrateTeamRatingMethods(sqlite);
  migrateBlendRatings(sqlite);
  migratePredictionConsensusMode(sqlite);
  migrateLegacyMasterAggregates(sqlite);
  ensureDefaultPrediction(sqlite);
  migratePredictionFrozenMatches(sqlite);
}

function migratePredictionConsensusMode(sqlite: Database.Database) {
  const columns = sqlite.prepare('PRAGMA table_info(predictions)').all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('consensus_mode')) {
    sqlite.exec(
      "ALTER TABLE predictions ADD COLUMN consensus_mode TEXT NOT NULL DEFAULT 'expected'",
    );
  }
  sqlite.exec("UPDATE predictions SET consensus_mode = 'expected' WHERE consensus_mode IS NULL");
}

function migrateTeamsElo(sqlite: Database.Database) {
  const teamColumns = sqlite.prepare('PRAGMA table_info(teams)').all() as Array<{
    name: string;
  }>;
  const teamColumnNames = new Set(teamColumns.map((column) => column.name));
  if (!teamColumnNames.has('elo')) {
    sqlite.exec('ALTER TABLE teams ADD COLUMN elo INTEGER');
    sqlite.exec('UPDATE teams SET elo = rating');
  }
}

function migrateTeamRatingMethods(sqlite: Database.Database) {
  const teamColumns = sqlite.prepare('PRAGMA table_info(teams)').all() as Array<{
    name: string;
  }>;
  const teamColumnNames = new Set(teamColumns.map((column) => column.name));
  if (teamColumnNames.has('elo_offensive_rating')) return;

  sqlite.exec('ALTER TABLE teams ADD COLUMN elo_offensive_rating REAL');
  sqlite.exec('ALTER TABLE teams ADD COLUMN elo_defensive_rating REAL');
  sqlite.exec('ALTER TABLE teams ADD COLUMN goal_offensive_rating REAL');
  sqlite.exec('ALTER TABLE teams ADD COLUMN goal_defensive_rating REAL');

  if (teamColumnNames.has('offensive_rating')) {
    sqlite.exec(`
      UPDATE teams
      SET elo_offensive_rating = offensive_rating,
          elo_defensive_rating = defensive_rating
      WHERE elo_offensive_rating IS NULL
    `);
  }

  const rows = sqlite
    .prepare('SELECT id, elo, rating, goals_for, goals_against, total FROM teams')
    .all() as Array<{
    id: number;
    elo: number | null;
    rating: number;
    goals_for: number;
    goals_against: number;
    total: number;
  }>;
  if (rows.length === 0) return;

  const computed = computeNormalizedTeamRatings(
    rows.map((row) => ({
      elo: row.elo ?? row.rating,
      goalsFor: row.goals_for,
      goalsAgainst: row.goals_against,
      total: row.total,
    })),
  );

  const update = sqlite.prepare(`
    UPDATE teams
    SET elo_offensive_rating = ?,
        elo_defensive_rating = ?,
        goal_offensive_rating = ?,
        goal_defensive_rating = ?
    WHERE id = ?
  `);
  const apply = sqlite.transaction((items: typeof computed) => {
    for (const [index, row] of items.entries()) {
      update.run(
        row.eloOffensiveRating,
        row.eloDefensiveRating,
        row.goalOffensiveRating,
        row.goalDefensiveRating,
        rows[index]!.id,
      );
    }
  });
  apply(computed);
}

function migrateBlendRatings(sqlite: Database.Database) {
  const teamColumns = sqlite.prepare('PRAGMA table_info(teams)').all() as Array<{
    name: string;
  }>;
  const teamColumnNames = new Set(teamColumns.map((column) => column.name));
  if (!teamColumnNames.has('blend_offensive_rating')) {
    sqlite.exec('ALTER TABLE teams ADD COLUMN blend_offensive_rating REAL');
    sqlite.exec('ALTER TABLE teams ADD COLUMN blend_defensive_rating REAL');
  }

  if (!tableExists(sqlite, 'app_settings')) {
    sqlite.exec(`
      CREATE TABLE app_settings (
        id INTEGER PRIMARY KEY,
        rating_elo_weight REAL NOT NULL
      )
    `);
  }

  const settingsCount = (
    sqlite.prepare('SELECT COUNT(*) as c FROM app_settings').get() as { c: number }
  ).c;
  if (settingsCount === 0) {
    sqlite.prepare('INSERT INTO app_settings (id, rating_elo_weight) VALUES (1, 1)').run();
  }

  const eloWeight = (
    sqlite.prepare('SELECT rating_elo_weight as w FROM app_settings WHERE id = 1').get() as
      | { w: number }
      | undefined
  )?.w ?? 1;

  const rows = sqlite
    .prepare('SELECT id, elo, rating, goals_for, goals_against, total FROM teams')
    .all() as Array<{
    id: number;
    elo: number | null;
    rating: number;
    goals_for: number;
    goals_against: number;
    total: number;
  }>;
  if (rows.length === 0) return;

  const blended = computeBlendedNormalizedRatings(
    rows.map((row) => ({
      elo: row.elo ?? row.rating,
      goalsFor: row.goals_for,
      goalsAgainst: row.goals_against,
      total: row.total,
    })),
    eloWeight,
  );

  const update = sqlite.prepare(`
    UPDATE teams
    SET blend_offensive_rating = ?,
        blend_defensive_rating = ?
    WHERE id = ?
  `);
  const apply = sqlite.transaction((items: typeof blended) => {
    for (const [index, [off, def]] of items.entries()) {
      update.run(off, def, rows[index]!.id);
    }
  });
  apply(blended);
}

function migrateLegacyMasterAggregates(sqlite: Database.Database) {
  if (!tableExists(sqlite, 'master_match_outcomes')) return;
  if (tableExists(sqlite, 'predictions')) {
    const existing = sqlite.prepare('SELECT COUNT(*) AS n FROM predictions').get() as { n: number };
    if (existing.n > 0) {
      dropLegacyMasterTables(sqlite);
      return;
    }
  }

  const maxSimRow = sqlite.prepare('SELECT MAX(id) AS maxId FROM simulations').get() as {
    maxId: number | null;
  };
  const maxSimId = maxSimRow.maxId ?? 0;
  if (maxSimId === 0) {
    dropLegacyMasterTables(sqlite);
    return;
  }

  const now = new Date().toISOString();
  const selectionSpec = JSON.stringify({
    type: 'ranges',
    ranges: [[1, maxSimId]],
  } satisfies SelectionSpec);

  sqlite.exec('BEGIN');
  try {
    sqlite
      .prepare(
        `INSERT INTO predictions (id, name, selection_spec, consensus_mode, created_at, updated_at)
         VALUES (1, 'Default', ?, 'expected', ?, ?)`,
      )
      .run(selectionSpec, now, now);

    sqlite.exec(`
      INSERT INTO prediction_match_outcomes (prediction_id, match_number, home_win, draw, away_win, total)
      SELECT 1, match_number, home_win, draw, away_win, total FROM master_match_outcomes;

      INSERT INTO prediction_match_scorelines (prediction_id, match_number, goals_home, goals_away, count)
      SELECT 1, match_number, goals_home, goals_away, count FROM master_match_scorelines;

      INSERT INTO prediction_team_stats (prediction_id, team_id, total_goals, simulations_with_matches, champion_wins)
      SELECT 1, team_id, total_goals, simulations_with_matches, champion_wins FROM master_team_stats;
    `);

    if (tableExists(sqlite, 'simulation_group_match_results')) {
      sqlite.exec(`
        INSERT INTO prediction_group_match_results (prediction_id, simulation_id, match_number, goals_home, goals_away)
        SELECT 1, simulation_id, match_number, goals_home, goals_away FROM simulation_group_match_results;
      `);
    }

    if (tableExists(sqlite, 'simulation_team_goals')) {
      sqlite.exec(`
        INSERT INTO prediction_simulation_team_goals (prediction_id, simulation_id, team_id, goals)
        SELECT 1, simulation_id, team_id, goals FROM simulation_team_goals;
      `);
    }

    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }

  dropLegacyMasterTables(sqlite);
}

function dropLegacyMasterTables(sqlite: Database.Database) {
  sqlite.exec(`
    DROP TABLE IF EXISTS master_match_outcomes;
    DROP TABLE IF EXISTS master_match_scorelines;
    DROP TABLE IF EXISTS master_team_stats;
    DROP TABLE IF EXISTS simulation_group_match_results;
    DROP TABLE IF EXISTS simulation_team_goals;
  `);
}

function migratePredictionFrozenMatches(sqlite: Database.Database) {
  if (!tableExists(sqlite, 'prediction_frozen_matches')) {
    sqlite.exec(`
      CREATE TABLE prediction_frozen_matches (
        prediction_id INTEGER NOT NULL REFERENCES predictions(id),
        match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
        home_win INTEGER NOT NULL,
        draw INTEGER NOT NULL,
        away_win INTEGER NOT NULL,
        total INTEGER NOT NULL,
        scorelines_json TEXT NOT NULL,
        frozen_at TEXT NOT NULL,
        PRIMARY KEY (prediction_id, match_number)
      )
    `);
  }

  if (!tableExists(sqlite, 'schema_flags')) {
    sqlite.exec(`
      CREATE TABLE schema_flags (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  if (!tableExists(sqlite, 'predictions') || !tableExists(sqlite, 'actual_match_results')) {
    return;
  }

  const migrated = sqlite
    .prepare("SELECT 1 AS ok FROM schema_flags WHERE key = 'frozen_from_default_v1'")
    .get();
  if (migrated) return;

  const db = drizzle(sqlite, { schema });
  migrateExistingFrozenMatches(db);
  sqlite
    .prepare("INSERT INTO schema_flags (key, value) VALUES ('frozen_from_default_v1', '1')")
    .run();
}

function ensureDefaultPrediction(sqlite: Database.Database) {
  const count = sqlite.prepare('SELECT COUNT(*) AS n FROM predictions').get() as { n: number };
  if (count.n > 0) return;

  const maxSimRow = sqlite.prepare('SELECT MAX(id) AS maxId FROM simulations').get() as {
    maxId: number | null;
  };
  const maxSimId = maxSimRow.maxId ?? 0;
  if (maxSimId === 0) return;

  const now = new Date().toISOString();
  const selectionSpec = JSON.stringify({
    type: 'ranges',
    ranges: [[1, maxSimId]],
  } satisfies SelectionSpec);

  sqlite
    .prepare(
      `INSERT INTO predictions (id, name, selection_spec, consensus_mode, created_at, updated_at)
       VALUES (1, 'Default', ?, 'expected', ?, ?)`,
    )
    .run(selectionSpec, now, now);

  const db = drizzle(sqlite, { schema });
  rebuildPredictionAggregates(db, 1, { type: 'ranges', ranges: [[1, maxSimId]] });
}

export function openDatabase(dbPath = getDefaultDbPath()): {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
} {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  initSchema(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type Db = ReturnType<typeof openDatabase>['db'];
