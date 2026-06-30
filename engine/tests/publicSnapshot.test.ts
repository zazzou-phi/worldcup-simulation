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

  it('exports the active prediction from manage predictions', () => {
    const sim1 = repo.createSimulation('Sim 1');
    const sim2 = repo.createSimulation('Sim 2');
    repo.createPrediction('Pool A', String(sim1.id));
    const poolB = repo.createPrediction('Pool B', String(sim2.id));
    repo.touchPrediction(poolB.id);

    const snapshot = buildPublicSnapshot(repo);

    expect(snapshot.meta.predictionId).toBe(poolB.id);
    expect(snapshot.meta.predictionName).toBe('Pool B');
    expect(snapshot.masterTeamStats.simulationCount).toBe(1);
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
      repo.getActualResults(),
    );

    const groupA = redacted.groupStandings.find((g) => g.groupLetter === 'A')!;
    const mexico = groupA.rows.find((r) => r.team.name === 'Mexico')!;
    const korea = groupA.rows.find((r) => r.team.name === 'South Korea');

    expect(mexico.points).toBe(3);
    expect(korea?.points ?? 0).toBe(0);
  });

  it('redacts pre-kickoff knockout predictions and downstream winner slots', () => {
    const sim = repo.createSimulation('Full group');
    const groupFixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of groupFixtures) {
      repo.updateMatchResult(sim.id, f.matchNumber, 1, 0, f.teamHomeId!);
    }

    const predictionId = ensureTestPrediction(repo);
    repo.rebuildAllPredictionAggregates();
    repo.simulatePredictionKnockoutRoundForPrediction(predictionId, 'round_of_32', { count: 100 });

    const exportTime = new Date(parseKickoff('2026-06-29', '12:00 UTC-5').getTime());
    const snapshot = buildPublicSnapshot(repo, exportTime);

    const r32Revealed = snapshot.masterKnockoutState.resolvedMatches.find(
      (m) => m.fixture.matchNumber === 73,
    )!;
    const r32Hidden = snapshot.masterKnockoutState.resolvedMatches.find(
      (m) => m.fixture.matchNumber === 75,
    )!;
    const r16Hidden = snapshot.masterKnockoutState.resolvedMatches.find(
      (m) => m.fixture.matchNumber === 90,
    )!;

    expect(r32Revealed.result.status).toBe('played');
    expect(r32Revealed.result.goalsHome).not.toBeNull();
    expect(snapshot.masterKnockoutState.distributions['73'].total).toBeGreaterThan(0);

    expect(r32Hidden.result.status).toBe('scheduled');
    expect(r32Hidden.result.goalsHome).toBeNull();
    expect(snapshot.masterKnockoutState.distributions['75'].total).toBe(0);

    expect(r16Hidden.result.status).toBe('scheduled');
    expect(r16Hidden.result.goalsHome).toBeNull();
    expect(r16Hidden.homeLabel).not.toBe(r16Hidden.awayLabel);
    expect(r16Hidden.awayLabel).toBe('W75');
    expect(r16Hidden.awayTeam).toBeNull();
  });

  it('omits unrevealed knockout actual results from bootstrap', () => {
    const sim = repo.createSimulation('Full group');
    const groupFixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of groupFixtures) {
      repo.updateMatchResult(sim.id, f.matchNumber, 1, 0, f.teamHomeId!);
    }

    ensureTestPrediction(repo);
    repo.setActualResult(73, 2, 0, null);
    repo.setActualResult(75, 1, 0, null);

    const exportTime = new Date(parseKickoff('2026-06-29', '12:00 UTC-5').getTime());
    const snapshot = buildPublicSnapshot(repo, exportTime);

    expect(snapshot.bootstrap.actualResults.some((result) => result.matchNumber === 73)).toBe(true);
    expect(snapshot.bootstrap.actualResults.some((result) => result.matchNumber === 75)).toBe(false);
    expect(
      snapshot.actualResultsState.resolvedMatches.find((m) => m.fixture.matchNumber === 75)?.result
        .status,
    ).toBe('scheduled');
  });
});
