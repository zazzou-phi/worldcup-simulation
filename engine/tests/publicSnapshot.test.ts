import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { initSchema } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { Repository } from '../src/db/repository.js';
import { buildPublicSnapshot, redactMasterGroupState } from '../src/export/publicSnapshot.js';
import { parseKickoff } from '../src/engine/kickoff.js';

function ensureTestPrediction(repo: Repository, maxId = 9999): number {
  const existing = repo.getActivePrediction();
  if (existing) return existing.id;
  if (repo.listSimulations().length === 0) {
    repo.createSimulation('Seed');
  }
  return repo.createPrediction('Test pool', `1-${maxId}`).id;
}

describe('publicSnapshot', () => {
  let repo: Repository;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    initSchema(sqlite);
    seedDatabase(sqlite);
    repo = new Repository(drizzle(sqlite, { schema }));
  });

  it('redacts pre-kickoff master predictions', () => {
    const sim = repo.createSimulation('Test');
    ensureTestPrediction(repo);
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    repo.updateMatchResult(sim.id, 2, 1, 1, null);

    const exportTime = new Date(parseKickoff('2026-06-11', '13:00 UTC-6').getTime() + 60_000);
    const snapshot = buildPublicSnapshot(repo, exportTime);

    const match1 = snapshot.masterGroupState.resolvedMatches.find(
      (m) => m.fixture.matchNumber === 1,
    )!;
    const match2 = snapshot.masterGroupState.resolvedMatches.find(
      (m) => m.fixture.matchNumber === 2,
    )!;

    expect(match1.result.status).toBe('played');
    expect(match1.result.goalsHome).toBe(2);
    expect(snapshot.masterGroupState.distributions['1'].total).toBeGreaterThan(0);

    expect(match2.result.status).toBe('scheduled');
    expect(match2.result.goalsHome).toBeNull();
    expect(snapshot.masterGroupState.distributions['2'].total).toBe(0);
  });

  it('includes full team stats regardless of kickoff', () => {
    const sim = repo.createSimulation('Test');
    ensureTestPrediction(repo);
    repo.updateMatchResult(sim.id, 1, 3, 0, 18);

    const exportTime = new Date('2020-01-01T00:00:00.000Z');
    const snapshot = buildPublicSnapshot(repo, exportTime);

    expect(snapshot.masterTeamStats.simulationCount).toBeGreaterThan(0);
    expect(snapshot.masterTeamStats.teams.length).toBeGreaterThan(0);
    expect(snapshot.bootstrap.teams.length).toBeGreaterThan(0);
    expect(snapshot.bootstrap.fixtures.length).toBe(104);
  });

  it('recomputes standings from revealed matches only', () => {
    const sim = repo.createSimulation('Test');
    const predictionId = ensureTestPrediction(repo);
    const fixtures = repo.getFixtures();
    const match1 = fixtures.find((f) => f.matchNumber === 1)!;
    const match2 = fixtures.find((f) => f.matchNumber === 2)!;
    repo.updateMatchResult(sim.id, 1, 2, 0, match1.teamHomeId);
    repo.updateMatchResult(sim.id, 2, 0, 3, match2.teamAwayId);

    const exportTime = new Date(parseKickoff('2026-06-11', '13:00 UTC-6').getTime() + 60_000);
    const raw = repo.buildMasterGroupView(predictionId);
    const redacted = redactMasterGroupState(
      raw,
      exportTime,
      repo.getGroupMemberships(),
      repo.getFixtures(),
    );

    const groupA = redacted.groupStandings.find((g) => g.groupLetter === 'A')!;
    const mexico = groupA.rows.find((r) => r.team.name === 'Mexico')!;
    const korea = groupA.rows.find((r) => r.team.name === 'South Korea');

    expect(mexico.points).toBe(3);
    expect(korea?.points ?? 0).toBe(0);
  });
});
