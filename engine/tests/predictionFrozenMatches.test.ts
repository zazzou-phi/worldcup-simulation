import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { initSchema } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { Repository } from '../src/db/repository.js';
import { readPredictionMatchDistributions } from '../src/db/predictionAggregates.js';
import { readFrozenMatchDistributions, copyCanonicalFrozenMatchesFromDefault } from '../src/db/predictionFrozenMatches.js';
import { performPredictionSample, readPredictionSampleResults, upsertPredictionSampleResult } from '../src/db/predictionSample.js';

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

  it('updates frozen consensus mode for a locked match', () => {
    const sim = repo.createSimulation('Frozen consensus API');
    const prediction = repo.createPrediction('Pool', `${sim.id}-${sim.id}`);
    repo.setPredictionConsensusMode(prediction.id, 'floor');
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    repo.setActualResult(1, 2, 0, 18);

    repo.setFrozenMatchConsensusMode(prediction.id, 1, 'scoreline');
    let master = repo.buildMasterGroupView(prediction.id);
    expect(master.distributions[1].consensusMode).toBe('scoreline');

    repo.setFrozenMatchConsensusMode(prediction.id, 1, 'rounded');
    master = repo.buildMasterGroupView(prediction.id);
    expect(master.distributions[1].consensusMode).toBe('rounded');
  });

  it('freezes consensus mode when an actual result is entered', () => {
    const sim = repo.createSimulation('Consensus freeze');
    const predictionId = ensureTestPrediction(repo);
    repo.setPredictionConsensusMode(predictionId, 'scoreline');
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    repo.updateMatchResult(sim.id, 2, 3, 3, null);

    repo.setActualResult(1, 2, 0, 18);

    repo.setPredictionConsensusMode(predictionId, 'floor');
    const master = repo.buildMasterGroupView(predictionId);
    expect(master.distributions[1].consensusMode).toBe('scoreline');
    expect(master.resolvedMatches.find((m) => m.fixture.matchNumber === 1)?.result.goalsHome).toBe(
      2,
    );

    const unlocked = master.resolvedMatches.find((m) => m.fixture.matchNumber === 2);
    expect(unlocked?.result.status).toBe('played');
    expect(master.distributions[2]?.consensusMode).toBeUndefined();
  });

  it('freezes sample goals when an actual result is entered in sample mode', () => {
    const sim = repo.createSimulation('Sample freeze');
    const predictionId = ensureTestPrediction(repo);
    repo.setPredictionConsensusMode(predictionId, 'sample');
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    performPredictionSample(db, predictionId);
    const sampled = readPredictionSampleResults(db, predictionId).get(1)!;

    repo.setActualResult(1, 2, 0, 18);

    const frozen = readFrozenMatchDistributions(db, predictionId);
    expect(frozen.sampleGoalsByMatch.get(1)).toEqual({
      goalsHome: sampled.goalsHome,
      goalsAway: sampled.goalsAway,
    });
  });

  it('backfills locked predictions from Default for pools with only post-result simulations', () => {
    const defaultSim = repo.createSimulation('Default pool');
    const defaultId = repo.createPrediction('Default', `${defaultSim.id}-${defaultSim.id}`).id;
    repo.updateMatchResult(defaultSim.id, 1, 2, 1, 18);
    repo.updateMatchResult(defaultSim.id, 2, 1, 1, null);
    repo.setActualResult(1, 2, 0, 18);
    const fixture2 = repo.getFixtures().find((f) => f.matchNumber === 2)!;
    repo.setActualResult(2, 2, 1, fixture2.teamHomeId!);

    const postLockSim = repo.createSimulation('Post-lock pool');
    repo.updateMatchResult(postLockSim.id, 3, 1, 0, 18);
    const newId = repo.createPrediction('Post-lock', `${postLockSim.id}-${postLockSim.id}`).id;

    const master = repo.buildMasterGroupView(newId);
    expect(master.distributions[1].total).toBeGreaterThan(0);
    expect(master.distributions[2].total).toBeGreaterThan(0);
    expect(master.resolvedMatches.find((m) => m.fixture.matchNumber === 1)?.result.status).toBe(
      'played',
    );
    expect(master.resolvedMatches.find((m) => m.fixture.matchNumber === 2)?.result.status).toBe(
      'played',
    );
    expect(master.distributions[3].total).toBe(1);
  });

  it('stores locked sample prediction on the actual result when entered', () => {
    const sim = repo.createSimulation('Sample actual');
    const predictionId = ensureTestPrediction(repo);
    repo.setPredictionConsensusMode(predictionId, 'sample');
    repo.updateMatchResult(sim.id, 61, 4, 1, 5);
    upsertPredictionSampleResult(db, predictionId, 61, 4, 1, new Date().toISOString());
    repo.touchPrediction(predictionId);

    repo.setActualResult(61, 1, 1, null);

    const actual = repo.getActualResult(61)!;
    expect(actual.predictedGoalsHome).toBe(4);
    expect(actual.predictedGoalsAway).toBe(1);
  });

  it('keeps frozen floor predictions visible when pool consensus mode is sample', () => {
    const sim = repo.createSimulation('Floor freeze');
    const predictionId = ensureTestPrediction(repo);
    repo.setPredictionConsensusMode(predictionId, 'floor');
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    repo.setActualResult(1, 2, 0, 18);

    repo.setPredictionConsensusMode(predictionId, 'sample');
    const view = repo.buildMasterGroupView(predictionId);
    const match = view.resolvedMatches.find((m) => m.fixture.matchNumber === 1)!;

    expect(view.distributions[1].consensusMode).toBe('floor');
    expect(match.result.status).toBe('played');
    expect(match.result.goalsHome).toBe(2);
    expect(match.result.goalsAway).toBe(1);
  });

  it('forces canonical locked sample scores across predictions in sample mode', () => {
    const defaultSim = repo.createSimulation('Default pool');
    const otherSim = repo.createSimulation('Other pool');
    const defaultId = ensureTestPrediction(repo);
    const sqlite = (db as { $client?: import('better-sqlite3').Database }).$client!;
    sqlite
      .prepare('UPDATE predictions SET selection_spec = ? WHERE id = ?')
      .run(JSON.stringify({ type: 'ranges', ranges: [[defaultSim.id, defaultSim.id]] }), defaultId);
    const otherId = repo.createPrediction('Other', `${otherSim.id}-${otherSim.id}`).id;

    repo.setPredictionConsensusMode(defaultId, 'sample');
    repo.setPredictionConsensusMode(otherId, 'sample');
    repo.updateMatchResult(defaultSim.id, 61, 4, 1, 5);
    repo.updateMatchResult(otherSim.id, 61, 1, 0, 5);
    upsertPredictionSampleResult(db, defaultId, 61, 4, 1, new Date().toISOString());
    upsertPredictionSampleResult(db, otherId, 61, 1, 0, new Date().toISOString());

    repo.touchPrediction(defaultId);
    repo.setActualResult(61, 1, 1, null);

    const defaultView = repo.buildMasterGroupView(defaultId);
    const otherView = repo.buildMasterGroupView(otherId);
    const defaultMatch = defaultView.resolvedMatches.find((m) => m.fixture.matchNumber === 61)!;
    const otherMatch = otherView.resolvedMatches.find((m) => m.fixture.matchNumber === 61)!;

    expect(defaultMatch.result.goalsHome).toBe(4);
    expect(defaultMatch.result.goalsAway).toBe(1);
    expect(otherMatch.result).toEqual(defaultMatch.result);
  });

  it('uses canonical locked sample scores when a prediction is missing its own', () => {
    const defaultSim = repo.createSimulation('Default pool');
    const defaultId = ensureTestPrediction(repo);
    repo.renamePrediction(defaultId, 'Default');
    const sqlite = (db as { $client?: import('better-sqlite3').Database }).$client!;
    sqlite
      .prepare('UPDATE predictions SET selection_spec = ? WHERE id = ?')
      .run(JSON.stringify({ type: 'ranges', ranges: [[defaultSim.id, defaultSim.id]] }), defaultId);

    repo.setPredictionConsensusMode(defaultId, 'sample');
    repo.updateMatchResult(defaultSim.id, 1, 2, 1, 18);
    upsertPredictionSampleResult(db, defaultId, 1, 2, 1, new Date().toISOString());

    repo.setActualResult(1, 2, 0, 18);

    const postLockSim = repo.createSimulation('Post-lock pool');
    repo.updateMatchResult(postLockSim.id, 2, 1, 0, 32);
    const otherId = repo.createPrediction('Post-lock', `${postLockSim.id}-${postLockSim.id}`).id;
    repo.setPredictionConsensusMode(otherId, 'sample');
    performPredictionSample(db, otherId);

    const defaultView = repo.buildMasterGroupView(defaultId);
    const otherView = repo.buildMasterGroupView(otherId);
    const defaultMatch = defaultView.resolvedMatches.find((m) => m.fixture.matchNumber === 1)!;
    const otherMatch = otherView.resolvedMatches.find((m) => m.fixture.matchNumber === 1)!;
    expect(otherMatch.result).toEqual(defaultMatch.result);

    performPredictionSample(db, otherId);
    const afterResample = repo.buildMasterGroupView(otherId);
    const afterMatch = afterResample.resolvedMatches.find((m) => m.fixture.matchNumber === 1)!;
    expect(afterMatch.result).toEqual(otherMatch.result);
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
