import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { initSchema } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { Repository } from '../src/db/repository.js';
import type { Db } from '../src/db/client.js';
import {
  performPredictionSample,
  PredictionSampleError,
  readPredictionSampleResults,
  readPredictionSampleSummary,
} from '../src/db/predictionSample.js';

describe('predictionSample', () => {
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

  function seedPoolWithTwoScores() {
    const sim1 = repo.createSimulation('Sample A');
    const sim2 = repo.createSimulation('Sample B');
    const prediction = repo.createPrediction('Sample pool', `${sim1.id}-${sim2.id}`);
    repo.updateMatchResult(sim1.id, 1, 2, 1, 18);
    repo.updateMatchResult(sim2.id, 1, 0, 2, 19);
    return { prediction, sim1, sim2 };
  }

  it('throws when no eligible fixtures have pool data', () => {
    const prediction = repo.createPrediction('Empty', '1-9999');
    expect(() => performPredictionSample(db, prediction.id)).toThrow(PredictionSampleError);
  });

  it('samples one stored scoreline per unlocked group fixture', () => {
    const { prediction } = seedPoolWithTwoScores();
    const summary = performPredictionSample(db, prediction.id);
    expect(summary.matchCount).toBeGreaterThan(0);

    const sample = readPredictionSampleResults(db, prediction.id);
    expect(sample.get(1)).toBeDefined();
    const score = sample.get(1)!;
    expect(
      (score.goalsHome === 2 && score.goalsAway === 1) ||
        (score.goalsHome === 0 && score.goalsAway === 2),
    ).toBe(true);
  });

  it('excludes locked fixtures from sample results', () => {
    const { prediction, sim1, sim2 } = seedPoolWithTwoScores();
    repo.updateMatchResult(sim1.id, 2, 1, 1, null);
    repo.updateMatchResult(sim2.id, 2, 2, 0, null);
    repo.setActualResult(1, 3, 0, repo.getFixtures().find((f) => f.matchNumber === 1)!.teamHomeId!);

    const summary = performPredictionSample(db, prediction.id);
    expect(summary.matchCount).toBeGreaterThan(0);

    const sample = readPredictionSampleResults(db, prediction.id);
    expect(sample.has(1)).toBe(false);
    expect(sample.has(2)).toBe(true);
  });

  it('replaces all sample rows on resample with a new timestamp', async () => {
    const { prediction } = seedPoolWithTwoScores();
    const first = performPredictionSample(db, prediction.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = performPredictionSample(db, prediction.id);

    expect(second.matchCount).toBe(first.matchCount);
    expect(second.sampledAt).not.toBe(first.sampledAt);

    const summary = readPredictionSampleSummary(db, prediction.id);
    expect(summary?.sampledAt).toBe(second.sampledAt);
  });

  it('buildMasterGroupView uses sampled scores when consensus mode is sample', () => {
    const { prediction } = seedPoolWithTwoScores();
    performPredictionSample(db, prediction.id);
    repo.setPredictionConsensusMode(prediction.id, 'sample');

    const view = repo.buildMasterGroupView(prediction.id);
    const match = view.resolvedMatches.find((m) => m.fixture.matchNumber === 1)!;
    const sample = readPredictionSampleResults(db, prediction.id).get(1)!;

    expect(match.result.status).toBe('played');
    expect(match.result.goalsHome).toBe(sample.goalsHome);
    expect(match.result.goalsAway).toBe(sample.goalsAway);
    expect(view.sample?.matchCount).toBeGreaterThan(0);
  });

  it('does not apply saved sample when consensus mode is floor', () => {
    const { prediction } = seedPoolWithTwoScores();
    performPredictionSample(db, prediction.id);
    repo.setPredictionConsensusMode(prediction.id, 'floor');

    const view = repo.buildMasterGroupView(prediction.id);
    const match = view.resolvedMatches.find((m) => m.fixture.matchNumber === 1)!;
    const sample = readPredictionSampleResults(db, prediction.id).get(1)!;

    expect(match.result.status).toBe('played');
    expect(
      match.result.goalsHome !== sample.goalsHome || match.result.goalsAway !== sample.goalsAway,
    ).toBe(true);
  });

  it('clears sample results when prediction is deleted', () => {
    const { prediction } = seedPoolWithTwoScores();
    performPredictionSample(db, prediction.id);
    expect(readPredictionSampleSummary(db, prediction.id)).not.toBeNull();

    repo.deletePrediction(prediction.id);
    expect(readPredictionSampleSummary(db, prediction.id)).toBeNull();
  });

  it('migrates legacy draw results when an empty sample table already exists', () => {
    const legacySqlite = new Database(':memory:');
    legacySqlite.exec(`
      CREATE TABLE prediction_draw_results (
        prediction_id INTEGER NOT NULL,
        match_number INTEGER NOT NULL,
        goals_home INTEGER NOT NULL,
        goals_away INTEGER NOT NULL,
        drawn_at TEXT NOT NULL,
        PRIMARY KEY (prediction_id, match_number)
      );
      CREATE TABLE prediction_sample_results (
        prediction_id INTEGER NOT NULL,
        match_number INTEGER NOT NULL,
        goals_home INTEGER NOT NULL,
        goals_away INTEGER NOT NULL,
        sampled_at TEXT NOT NULL,
        PRIMARY KEY (prediction_id, match_number)
      );
      INSERT INTO prediction_draw_results (
        prediction_id, match_number, goals_home, goals_away, drawn_at
      ) VALUES (1, 1, 2, 1, '2026-06-01T00:00:00.000Z');
    `);

    initSchema(legacySqlite);
    const legacyDb = drizzle(legacySqlite, { schema });

    expect(tableExists(legacySqlite, 'prediction_draw_results')).toBe(false);
    const sample = readPredictionSampleResults(legacyDb, 1);
    expect(sample.get(1)).toEqual({
      goalsHome: 2,
      goalsAway: 1,
      sampledAt: '2026-06-01T00:00:00.000Z',
    });
  });
});

function tableExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row != null;
}
