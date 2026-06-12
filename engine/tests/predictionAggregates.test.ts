import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { initSchema } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { Repository } from '../src/db/repository.js';
import type { Db } from '../src/db/client.js';
import {
  readPredictionMatchDistributions,
  rebuildPredictionAggregates,
} from '../src/db/predictionAggregates.js';

describe('predictionAggregates', () => {
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
    const prediction = repo.createPrediction('Test', `${sim.id}-${sim.id + 99}`);
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);

    const { outcomesByMatch, scorelinesByMatch } = readPredictionMatchDistributions(
      db,
      prediction.id,
    );
    expect(outcomesByMatch.get(1)).toEqual({ homeWin: 1, draw: 0, awayWin: 0, total: 1 });
    expect(scorelinesByMatch.get(1)).toEqual([{ goalsHome: 2, goalsAway: 1, n: 1 }]);
  });

  it('excludes simulations outside the prediction range', () => {
    const sim1 = repo.createSimulation('One');
    const sim2 = repo.createSimulation('Two');
    const narrow = repo.createPrediction('Narrow', `${sim1.id}-${sim1.id}`);
    const wide = repo.createPrediction('Wide', `${sim1.id}-${sim2.id}`);

    repo.updateMatchResult(sim1.id, 1, 1, 0, 18);
    repo.updateMatchResult(sim2.id, 1, 0, 2, 19);

    const narrowView = readPredictionMatchDistributions(db, narrow.id);
    expect(narrowView.outcomesByMatch.get(1)).toEqual({
      homeWin: 1,
      draw: 0,
      awayWin: 0,
      total: 1,
    });

    const wideView = readPredictionMatchDistributions(db, wide.id);
    expect(wideView.outcomesByMatch.get(1)?.total).toBe(2);
  });

  it('rebuild matches incremental updates', () => {
    const sim = repo.createSimulation('Rebuild test');
    const prediction = repo.createPrediction('Test', `${sim.id}-${sim.id + 99}`);
    repo.updateMatchResult(sim.id, 1, 1, 1, null);
    repo.updateMatchResult(sim.id, 1, 2, 0, 18);

    sqlite.exec(`DELETE FROM prediction_match_outcomes WHERE prediction_id = ${prediction.id}`);
    sqlite.exec(`DELETE FROM prediction_match_scorelines WHERE prediction_id = ${prediction.id}`);
    sqlite.exec(`DELETE FROM prediction_group_match_results WHERE prediction_id = ${prediction.id}`);

    rebuildPredictionAggregates(db, prediction.id, prediction.selectionSpec);
    const { outcomesByMatch, scorelinesByMatch } = readPredictionMatchDistributions(
      db,
      prediction.id,
    );
    expect(outcomesByMatch.get(1)).toEqual({ homeWin: 1, draw: 0, awayWin: 0, total: 1 });
    expect(scorelinesByMatch.get(1)).toEqual([{ goalsHome: 2, goalsAway: 0, n: 1 }]);
  });
});
