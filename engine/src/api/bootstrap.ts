import type Database from 'better-sqlite3';
import { openDatabase, getDefaultDbPath } from '../db/client.js';
import { seedDatabase } from '../db/seed.js';
import { Repository } from '../db/repository.js';
import { createApiApp } from './app.js';

export interface ServerArgs {
  port: number;
  db: string;
  seed: boolean;
}

export function parseServerArgs(
  argv: string[],
  defaults: Partial<ServerArgs> = {},
): ServerArgs {
  const args: ServerArgs = {
    port: defaults.port ?? 3000,
    db: defaults.db ?? getDefaultDbPath(),
    seed: defaults.seed ?? false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') args.port = parseInt(argv[++i], 10);
    else if (a === '--db') args.db = argv[++i];
    else if (a === '--seed') args.seed = true;
  }
  return args;
}

export function ensureSeeded(sqlite: Database.Database, forceSeed: boolean) {
  if (!forceSeed) return;
  const result = seedDatabase(sqlite);
  console.log(`Seeded ${result.teamCount} teams, ${result.fixtureCount} fixtures`);
}

export function createRepository(dbPath = getDefaultDbPath(), forceSeed = false) {
  const { sqlite, db } = openDatabase(dbPath);
  ensureSeeded(sqlite, forceSeed);
  const repo = new Repository(db);
  repo.ensureDefaultSimulation();
  return repo;
}

export function createApiServer(repo: Repository) {
  return createApiApp(repo);
}
