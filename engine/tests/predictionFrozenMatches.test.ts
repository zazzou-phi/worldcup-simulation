import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { initSchema } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { Repository } from '../src/db/repository.js';
import { readPredictionMatchDistributions } from '../src/db/predictionAggregates.js';
import { readFrozenMatchDistributions, copyCanonicalFrozenMatchesFromDefault } from '../src/db/predictionFrozenMatches.js';

function ensureTestPrediction(repo: Repository, maxId = 9999): number {
  const existing = repo.getActivePrediction();
  if (existing) return existing.id;
  if (repo.listSimulations().length === 0) {
    repo.createSimulation('Seed');
  }
  return repo.createPrediction('Test pool', `1-${maxId}`).id;
}

describe('predictionFrozenMatches', () => {
  let repo: Repository;
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    initSchema(sqlite);
    seedDatabase(sqlite);
    db = drizzle(sqlite, { schema });
    repo = new Repository(db);
  });

  it('freezes master prediction when an actual result is first entered', () => {
    const sim = repo.createSimulation('Pre-result');
    const predictionId = ensureTestPrediction(repo);
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);

    repo.setActualResult(1, 3, 0, 18);

    const frozen = readFrozenMatchDistributions(db, predictionId);
    expect(frozen.outcomesByMatch.get(1)).toEqual({
      homeWin: 1,
      draw: 0,
      awayWin: 0,
      total: 1,
    });
    expect(frozen.scorelinesByMatch.get(1)).toEqual([{ goalsHome: 2, goalsAway: 1, n: 1 }]);

    const live = readPredictionMatchDistributions(db, predictionId);
    expect(live.outcomesByMatch.get(1)).toBeUndefined();

    const master = repo.buildMasterGroupView(predictionId);
    expect(master.distributions[1].total).toBe(1);
    expect(master.distributions[1].scorelines).toEqual([{ goalsHome: 2, goalsAway: 1, n: 1 }]);
    expect(master.resolvedMatches.find((m) => m.fixture.matchNumber === 1)?.result.goalsHome).toBe(
      2,
    );
  });

  it('does not change frozen prediction when new simulations run after a result', () => {
    const sim = repo.createSimulation('Pre-result');
    const predictionId = ensureTestPrediction(repo);
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    repo.setActualResult(1, 3, 0, 18);

    const afterLock = repo.buildMasterGroupView(predictionId);

    const later = repo.createSimulation('Post-result');
    repo.updateMatchResult(later.id, 2, 1, 0, 32);

    const afterMore = repo.buildMasterGroupView(predictionId);
    expect(afterMore.distributions[1]).toEqual(afterLock.distributions[1]);
    expect(afterMore.resolvedMatches.find((m) => m.fixture.matchNumber === 1)?.result).toEqual(
      afterLock.resolvedMatches.find((m) => m.fixture.matchNumber === 1)?.result,
    );
  });

  it('backfills frozen matches for predictions created after a result was entered', () => {
    const sim = repo.createSimulation('Historical');
    repo.updateMatchResult(sim.id, 1, 1, 1, null);
    repo.setActualResult(1, 0, 0, null);

    const predictionId = repo.createPrediction('Late pool', `${sim.id}-${sim.id + 99}`).id;
    const master = repo.buildMasterGroupView(predictionId);

    expect(master.distributions[1].total).toBe(1);
    expect(master.distributions[1].draw).toBe(1);
    expect(master.resolvedMatches.find((m) => m.fixture.matchNumber === 1)?.result.goalsHome).toBe(
      1,
    );
  });

  it('copies Default frozen stats to all predictions for locked matches', () => {
    const defaultSim = repo.createSimulation('Default pool');
    const otherSim = repo.createSimulation('Other pool');
    const defaultId = repo.createPrediction('Default', `${defaultSim.id}-${defaultSim.id}`).id;
    const otherId = repo.createPrediction('Other', `${otherSim.id}-${otherSim.id}`).id;

    repo.updateMatchResult(defaultSim.id, 1, 2, 1, 18);
    repo.updateMatchResult(otherSim.id, 1, 3, 0, 18);
    repo.setActualResult(1, 2, 0, 18);

    copyCanonicalFrozenMatchesFromDefault(db, defaultId);

    const defaultFrozen = readFrozenMatchDistributions(db, defaultId);
    const otherFrozen = readFrozenMatchDistributions(db, otherId);

    expect(defaultFrozen.outcomesByMatch.get(1)).toEqual({
      homeWin: 1,
      draw: 0,
      awayWin: 0,
      total: 1,
    });
    expect(otherFrozen.outcomesByMatch.get(1)).toEqual(defaultFrozen.outcomesByMatch.get(1));
    expect(otherFrozen.scorelinesByMatch.get(1)).toEqual(defaultFrozen.scorelinesByMatch.get(1));
  });

  it('restores live aggregates when an actual result is cleared', () => {
    const sim = repo.createSimulation('Restore');
    const predictionId = ensureTestPrediction(repo);
    repo.updateMatchResult(sim.id, 1, 2, 0, 18);
    repo.setActualResult(1, 3, 0, 18);
    repo.clearActualResult(1);

    const live = readPredictionMatchDistributions(db, predictionId);
    expect(live.outcomesByMatch.get(1)).toEqual({
      homeWin: 1,
      draw: 0,
      awayWin: 0,
      total: 1,
    });

    const frozen = readFrozenMatchDistributions(db, predictionId);
    expect(frozen.outcomesByMatch.get(1)).toBeUndefined();
  });
});
