import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { initSchema } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { Repository } from '../src/db/repository.js';
import type { Db } from '../src/db/client.js';
import {
  performPredictionDraw,
  PredictionDrawError,
  readPredictionDrawResults,
  readPredictionDrawSummary,
} from '../src/db/predictionDraw.js';

describe('predictionDraw', () => {
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
    const sim1 = repo.createSimulation('Draw A');
    const sim2 = repo.createSimulation('Draw B');
    const prediction = repo.createPrediction('Draw pool', `${sim1.id}-${sim2.id}`);
    repo.updateMatchResult(sim1.id, 1, 2, 1, 18);
    repo.updateMatchResult(sim2.id, 1, 0, 2, 19);
    return { prediction, sim1, sim2 };
  }

  it('throws when no eligible fixtures have pool data', () => {
    const prediction = repo.createPrediction('Empty', '1-9999');
    expect(() => performPredictionDraw(db, prediction.id)).toThrow(PredictionDrawError);
  });

  it('samples one stored scoreline per unlocked group fixture', () => {
    const { prediction } = seedPoolWithTwoScores();
    const summary = performPredictionDraw(db, prediction.id);
    expect(summary.matchCount).toBeGreaterThan(0);

    const draw = readPredictionDrawResults(db, prediction.id);
    expect(draw.get(1)).toBeDefined();
    const score = draw.get(1)!;
    expect(
      (score.goalsHome === 2 && score.goalsAway === 1) ||
        (score.goalsHome === 0 && score.goalsAway === 2),
    ).toBe(true);
  });

  it('excludes locked fixtures from draw results', () => {
    const { prediction, sim1, sim2 } = seedPoolWithTwoScores();
    repo.updateMatchResult(sim1.id, 2, 1, 1, null);
    repo.updateMatchResult(sim2.id, 2, 2, 0, null);
    repo.setActualResult(1, 3, 0, repo.getFixtures().find((f) => f.matchNumber === 1)!.teamHomeId!);

    const summary = performPredictionDraw(db, prediction.id);
    expect(summary.matchCount).toBeGreaterThan(0);

    const draw = readPredictionDrawResults(db, prediction.id);
    expect(draw.has(1)).toBe(false);
    expect(draw.has(2)).toBe(true);
  });

  it('replaces all draw rows on redraw with a new timestamp', async () => {
    const { prediction } = seedPoolWithTwoScores();
    const first = performPredictionDraw(db, prediction.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = performPredictionDraw(db, prediction.id);

    expect(second.matchCount).toBe(first.matchCount);
    expect(second.drawnAt).not.toBe(first.drawnAt);

    const summary = readPredictionDrawSummary(db, prediction.id);
    expect(summary?.drawnAt).toBe(second.drawnAt);
  });

  it('buildMasterGroupView uses drawn scores when consensus mode is draw', () => {
    const { prediction } = seedPoolWithTwoScores();
    performPredictionDraw(db, prediction.id);
    repo.setPredictionConsensusMode(prediction.id, 'draw');

    const view = repo.buildMasterGroupView(prediction.id);
    const match = view.resolvedMatches.find((m) => m.fixture.matchNumber === 1)!;
    const draw = readPredictionDrawResults(db, prediction.id).get(1)!;

    expect(match.result.status).toBe('played');
    expect(match.result.goalsHome).toBe(draw.goalsHome);
    expect(match.result.goalsAway).toBe(draw.goalsAway);
    expect(view.draw?.matchCount).toBeGreaterThan(0);
  });

  it('does not apply saved draw when consensus mode is expected', () => {
    const { prediction } = seedPoolWithTwoScores();
    performPredictionDraw(db, prediction.id);
    repo.setPredictionConsensusMode(prediction.id, 'expected');

    const view = repo.buildMasterGroupView(prediction.id);
    const match = view.resolvedMatches.find((m) => m.fixture.matchNumber === 1)!;
    const draw = readPredictionDrawResults(db, prediction.id).get(1)!;

    expect(match.result.status).toBe('played');
    expect(
      match.result.goalsHome !== draw.goalsHome || match.result.goalsAway !== draw.goalsAway,
    ).toBe(true);
  });

  it('clears draw results when prediction is deleted', () => {
    const { prediction } = seedPoolWithTwoScores();
    performPredictionDraw(db, prediction.id);
    expect(readPredictionDrawSummary(db, prediction.id)).not.toBeNull();

    repo.deletePrediction(prediction.id);
    expect(readPredictionDrawSummary(db, prediction.id)).toBeNull();
  });
});
