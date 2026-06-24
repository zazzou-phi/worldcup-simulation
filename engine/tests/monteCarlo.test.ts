import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { initSchema } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { Repository } from '../src/db/repository.js';
import { runMonteCarlo } from '../src/simulation/monteCarlo.js';
import { createApiApp } from '../src/api/app.js';
import { testRng } from './testRng.js';

describe('runMonteCarlo', () => {
  let repo: Repository;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    initSchema(sqlite);
    seedDatabase(sqlite);
    repo = new Repository(drizzle(sqlite, { schema }));
  });

  it('returns champion counts that sum to the run count', async () => {
    const result = await runMonteCarlo(repo, 50, { rng: testRng(), upsetVariance: 0 });
    const totalWins = result.champions.reduce((sum, row) => sum + row.wins, 0);
    expect(totalWins).toBe(50);
    expect(result.count).toBe(50);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.champions.length).toBeGreaterThan(0);
    expect(result.champions[0].winPct).toBeGreaterThan(0);
  });

  it('persists each tournament as a completed simulation', async () => {
    const before = repo.listSimulations().length;
    const result = await runMonteCarlo(repo, 3, { rng: testRng(), upsetVariance: 0 });

    expect(repo.listSimulations().length).toBe(before + 3);
    expect(result.firstSimulationId).toBeGreaterThan(0);
    expect(result.lastSimulationId).toBe(result.firstSimulationId + 2);
    expect(result.batchName.startsWith('Bulk ')).toBe(true);

    const saved = repo.getSimulation(result.firstSimulationId)!;
    expect(saved.phase).toBe('complete');
    expect(saved.name).toBe(`${result.batchName} #1`);

    const played = repo
      .getSimulationMatches(result.firstSimulationId)
      .filter((match) => match.status === 'played');
    expect(played.length).toBe(104);
  });

  it('reports progress at completion', async () => {
    const progress: Array<[number, number]> = [];
    await runMonteCarlo(repo, 25, {
      rng: testRng(),
      upsetVariance: 0,
      onProgress: (completed, total) => progress.push([completed, total]),
    });
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toEqual([25, 25]);
  });

  it('respects locked actual group results', async () => {
    const fixtures = repo.getFixtures().filter((f) => f.group === 'A');
    for (const fixture of fixtures) {
      repo.setActualResult(fixture.matchNumber, 1, 0, fixture.teamHomeId);
    }

    const result = await runMonteCarlo(repo, 10, { rng: testRng(), upsetVariance: 0 });
    expect(result.champions.reduce((sum, row) => sum + row.wins, 0)).toBe(10);
  });
});

describe('POST /api/v1/simulate/monte-carlo', () => {
  let app: ReturnType<typeof createApiApp>;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    initSchema(sqlite);
    seedDatabase(sqlite);
    app = createApiApp(new Repository(drizzle(sqlite, { schema })));
  });

  it('runs bulk simulation', async () => {
    const res = await app.request('/api/v1/simulate/monte-carlo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 25 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; champions: Array<{ wins: number }> };
    expect(body.count).toBe(25);
    expect(body.champions.reduce((sum, row) => sum + row.wins, 0)).toBe(25);
  });

  it('rejects invalid count', async () => {
    const res = await app.request('/api/v1/simulate/monte-carlo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts upsetVariance', async () => {
    const res = await app.request('/api/v1/simulate/monte-carlo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 5, upsetVariance: 0.35 }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects invalid upsetVariance', async () => {
    const res = await app.request('/api/v1/simulate/monte-carlo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 5, upsetVariance: 1.5 }),
    });
    expect(res.status).toBe(400);
  });

  it('streams progress when stream is true', async () => {
    const res = await app.request('/api/v1/simulate/monte-carlo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 10, stream: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');

    const text = await res.text();
    const events = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; completed?: number; result?: { count: number } });

    expect(events.some((e) => e.type === 'progress')).toBe(true);
    const resultEvent = events.find((e) => e.type === 'result');
    expect(resultEvent?.result?.count).toBe(10);
    const lastProgress = [...events].reverse().find((e) => e.type === 'progress');
    expect(lastProgress?.completed).toBe(10);
  });
});
