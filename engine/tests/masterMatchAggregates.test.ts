import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { initSchema } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { Repository } from '../src/db/repository.js';
import type { Db } from '../src/db/client.js';
import {
  readMasterMatchDistributions,
  rebuildAllMasterMatchAggregates,
} from '../src/db/masterMatchAggregates.js';

describe('masterMatchAggregates', () => {
  let repo: Repository;
  let db: Db;
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    initSchema(sqlite);
    seedDatabase(sqlite);
    db = drizzle(sqlite, { schema });
    repo = new Repository(db);
  });

  it('tracks outcome and scoreline counts per group match', () => {
    const sim = repo.createSimulation('Aggregate test');
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);

    const { outcomesByMatch, scorelinesByMatch } = readMasterMatchDistributions(db);
    expect(outcomesByMatch.get(1)).toEqual({ homeWin: 1, draw: 0, awayWin: 0, total: 1 });
    expect(scorelinesByMatch.get(1)).toEqual([{ goalsHome: 2, goalsAway: 1, n: 1 }]);
  });

  it('rebuild matches incremental updates', () => {
    const sim = repo.createSimulation('Rebuild test');
    repo.updateMatchResult(sim.id, 1, 1, 1, null);
    repo.updateMatchResult(sim.id, 1, 2, 0, 18);

    sqlite.exec('DELETE FROM master_match_outcomes');
    sqlite.exec('DELETE FROM master_match_scorelines');
    sqlite.exec('DELETE FROM simulation_group_match_results');

    rebuildAllMasterMatchAggregates(db);
    const { outcomesByMatch, scorelinesByMatch } = readMasterMatchDistributions(db);
    expect(outcomesByMatch.get(1)).toEqual({ homeWin: 1, draw: 0, awayWin: 0, total: 1 });
    expect(scorelinesByMatch.get(1)).toEqual([{ goalsHome: 2, goalsAway: 0, n: 1 }]);
  });
});
