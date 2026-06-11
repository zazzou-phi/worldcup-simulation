import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { rebuildAllMasterMatchAggregates } from './masterMatchAggregates.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getProjectDataDir(): string {
  return join(__dirname, '../../../data');
}

export function getDefaultDbPath(): string {
  return join(getProjectDataDir(), 'simulations.db');
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
      total INTEGER NOT NULL,
      goals_for INTEGER NOT NULL,
      goals_against INTEGER NOT NULL,
      offensive_rating REAL NOT NULL,
      defensive_rating REAL NOT NULL
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
    CREATE TABLE IF NOT EXISTS simulation_team_goals (
      simulation_id INTEGER NOT NULL REFERENCES simulations(id),
      team_id INTEGER NOT NULL REFERENCES teams(id),
      goals INTEGER NOT NULL,
      PRIMARY KEY (simulation_id, team_id)
    );
    CREATE TABLE IF NOT EXISTS master_team_stats (
      team_id INTEGER PRIMARY KEY REFERENCES teams(id),
      total_goals INTEGER NOT NULL,
      simulations_with_matches INTEGER NOT NULL,
      champion_wins INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS simulation_group_match_results (
      simulation_id INTEGER NOT NULL REFERENCES simulations(id),
      match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
      goals_home INTEGER NOT NULL,
      goals_away INTEGER NOT NULL,
      PRIMARY KEY (simulation_id, match_number)
    );
    CREATE TABLE IF NOT EXISTS master_match_outcomes (
      match_number INTEGER PRIMARY KEY REFERENCES fixtures(match_number),
      home_win INTEGER NOT NULL,
      draw INTEGER NOT NULL,
      away_win INTEGER NOT NULL,
      total INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS master_match_scorelines (
      match_number INTEGER NOT NULL REFERENCES fixtures(match_number),
      goals_home INTEGER NOT NULL,
      goals_away INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (match_number, goals_home, goals_away)
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

  const aggregateTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'master_match_outcomes'")
    .get();
  if (aggregateTable) {
    const aggregateCount = sqlite
      .prepare('SELECT COUNT(*) AS n FROM master_match_outcomes')
      .get() as { n: number };
    const playedGroupCount = sqlite
      .prepare(
        `SELECT COUNT(*) AS n
         FROM simulation_matches sm
         INNER JOIN fixtures f ON f.match_number = sm.match_number
         WHERE f."group" IS NOT NULL AND sm.status = 'played'`,
      )
      .get() as { n: number };
    if (aggregateCount.n === 0 && playedGroupCount.n > 0) {
      rebuildAllMasterMatchAggregates(drizzle(sqlite, { schema }));
    }
  }
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
