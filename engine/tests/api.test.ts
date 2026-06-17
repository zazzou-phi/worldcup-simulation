import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { initSchema } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { Repository } from '../src/db/repository.js';
import { createApiApp } from '../src/api/app.js';

describe('HTTP API', () => {
  let repo: Repository;
  let app: ReturnType<typeof createApiApp>;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    initSchema(sqlite);
    seedDatabase(sqlite);
    repo = new Repository(drizzle(sqlite, { schema }));
    app = createApiApp(repo);
  });

  async function json<T>(res: Response): Promise<T> {
    return res.json() as Promise<T>;
  }

  it('GET /health returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
  });

  it('POST /simulations then PUT match score', async () => {
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'API Test' }),
    });
    expect(create.status).toBe(201);
    const { id } = await json<{ id: number }>(create);

    const put = await app.request(`/api/v1/simulations/${id}/matches/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 2, goalsAway: 1 }),
    });
    expect(put.status).toBe(200);
    const body = await json<{
      match: { status: string; goalsHome: number; goalsAway: number };
      simulation: { phase: string };
    }>(put);
    expect(body.match.status).toBe('played');
    expect(body.match.goalsHome).toBe(2);
    expect(body.match.goalsAway).toBe(1);
    expect(body.simulation.phase).toBe('group');
  });

  it('DELETE clears a match score', async () => {
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Clear test' }),
    });
    const { id } = await json<{ id: number }>(create);

    await app.request(`/api/v1/simulations/${id}/matches/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 1, goalsAway: 0 }),
    });

    const del = await app.request(`/api/v1/simulations/${id}/matches/1`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    const body = await json<{ match: { status: string; goalsHome: null } }>(del);
    expect(body.match.status).toBe('scheduled');
    expect(body.match.goalsHome).toBeNull();
  });

  it('PUT returns 409 when later round simulation results exist', async () => {
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cascade edit' }),
    });
    const { id } = await json<{ id: number }>(create);

    await app.request(`/api/v1/simulations/${id}/matches/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 1, goalsAway: 0 }),
    });
    await app.request(`/api/v1/simulations/${id}/matches/3`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 2, goalsAway: 0 }),
    });

    const put = await app.request(`/api/v1/simulations/${id}/matches/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 3, goalsAway: 0 }),
    });
    expect(put.status).toBe(409);
    const body = await json<{ code: string }>(put);
    expect(body.code).toBe('match_clear_blocked');
  });

  it('DELETE returns 409 when later round simulation results exist', async () => {
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cascade clear' }),
    });
    const { id } = await json<{ id: number }>(create);

    await app.request(`/api/v1/simulations/${id}/matches/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 1, goalsAway: 0 }),
    });
    await app.request(`/api/v1/simulations/${id}/matches/3`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 2, goalsAway: 0 }),
    });

    const del = await app.request(`/api/v1/simulations/${id}/matches/1`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(409);
    const body = await json<{ code: string }>(del);
    expect(body.code).toBe('match_clear_blocked');
  });

  it('returns 404 for unknown simulation', async () => {
    const res = await app.request('/api/v1/simulations/999');
    expect(res.status).toBe(404);
    const body = await json<{ code: string }>(res);
    expect(body.code).toBe('simulation_not_found');
  });

  it('returns 404 for unknown match', async () => {
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    const { id } = await json<{ id: number }>(create);

    const res = await app.request(`/api/v1/simulations/${id}/matches/999`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 0, goalsAway: 0 }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 when knockout match participants are unresolved', async () => {
    const sim = repo.createSimulation('Knockout blocked');
    const res = await app.request(`/api/v1/simulations/${sim.id}/matches/90`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 1, goalsAway: 0 }),
    });
    expect(res.status).toBe(409);
    const body = await json<{ code: string }>(res);
    expect(body.code).toBe('match_not_ready');
  });

  it('returns 400 for knockout tie without winnerTeamId', async () => {
    const sim = repo.createSimulation('Knockout tie');
    playAllGroupMatches(sim.id);

    const res = await app.request(`/api/v1/simulations/${sim.id}/matches/73`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 1, goalsAway: 1 }),
    });
    expect(res.status).toBe(400);
    const body = await json<{ code: string }>(res);
    expect(body.code).toBe('winner_required');
  });

  it('accepts knockout tie with winnerTeamId', async () => {
    const sim = repo.createSimulation('Knockout tie ok');
    playAllGroupMatches(sim.id);

    const stateRes = await app.request(`/api/v1/simulations/${sim.id}/state`);
    const state = await json<{
      resolvedMatches: Array<{
        fixture: { matchNumber: number };
        homeTeam: { id: number } | null;
      }>;
    }>(stateRes);
    const r32 = state.resolvedMatches.find((m) => m.fixture.matchNumber === 73)!;
    const homeId = r32.homeTeam!.id;

    const res = await app.request(`/api/v1/simulations/${sim.id}/matches/73`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 1, goalsAway: 1, winnerTeamId: homeId }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ match: { winnerTeamId: number } }>(res);
    expect(body.match.winnerTeamId).toBe(homeId);
  });

  it('GET /state resolves R32 teams after group stage complete', async () => {
    const sim = repo.createSimulation('Full group');
    playAllGroupMatches(sim.id);

    const res = await app.request(`/api/v1/simulations/${sim.id}/state`);
    expect(res.status).toBe(200);
    const state = await json<{
      simulation: { phase: string };
      resolvedMatches: Array<{
        fixture: { matchNumber: number };
        homeTeam: unknown;
        awayTeam: unknown;
      }>;
    }>(res);
    expect(state.simulation.phase).toBe('g3');
    const r32 = state.resolvedMatches.find((m) => m.fixture.matchNumber === 73)!;
    expect(r32.homeTeam).not.toBeNull();
    expect(r32.awayTeam).not.toBeNull();
  });

  it('PATCH /simulations/:id renames simulation', async () => {
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Old name' }),
    });
    const { id } = await json<{ id: number }>(create);

    const res = await app.request(`/api/v1/simulations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New name' }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ name: string }>(res);
    expect(body.name).toBe('New name');
  });

  it('DELETE /simulations/:id removes simulation', async () => {
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'To delete' }),
    });
    const { id } = await json<{ id: number }>(create);

    const del = await app.request(`/api/v1/simulations/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const get = await app.request(`/api/v1/simulations/${id}`);
    expect(get.status).toBe(404);
  });

  it('GET /simulations includes playedCount', async () => {
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Count test' }),
    });
    const { id } = await json<{ id: number }>(create);

    await app.request(`/api/v1/simulations/${id}/matches/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 2, goalsAway: 1 }),
    });
    await app.request(`/api/v1/simulations/${id}/matches/2`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 0, goalsAway: 0 }),
    });

    const list = await json<{ items: Array<{ id: number; playedCount: number }> }>(
      await app.request('/api/v1/simulations'),
    );
    const sim = list.items.find((entry) => entry.id === id);
    expect(sim?.playedCount).toBe(2);
  });

  it('POST /simulations/:id/activate touches simulation', async () => {
    const first = repo.createSimulation('First');
    const second = repo.createSimulation('Second');

    const res = await app.request(`/api/v1/simulations/${first.id}/activate`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);

    const list = await json<{ items: Array<{ id: number }> }>(
      await app.request('/api/v1/simulations'),
    );
    expect(list.items[0].id).toBe(first.id);
    expect(list.items.some((s) => s.id === second.id)).toBe(true);
  });

  it('GET /teams returns all teams', async () => {
    const res = await app.request('/api/v1/teams');
    expect(res.status).toBe(200);
    const teams = await json<Array<{ id: number; name: string }>>(res);
    expect(teams.length).toBeGreaterThan(0);
  });

  it('PUT /settings/rating-elo-weight updates blend ratings', async () => {
    const teams = repo.getTeams();
    const team = teams[0];
    const before = team.blendOffensiveRating;

    const res = await app.request('/api/v1/settings/rating-elo-weight', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ratingEloWeight: 0 }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ ratingEloWeight: number }>(res);
    expect(body.ratingEloWeight).toBe(0);

    const updated = repo.getTeams().find((t) => t.id === team.id)!;
    expect(updated.blendOffensiveRating).not.toBe(before);
  });

  it('PUT /settings/tournament-elo-delta-weight updates tournament form', async () => {
    const res = await app.request('/api/v1/settings/tournament-elo-delta-weight', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournamentEloDeltaWeight: 3 }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ tournamentEloDeltaWeight: number }>(res);
    expect(body.tournamentEloDeltaWeight).toBe(3);
    expect(repo.getTournamentEloDeltaWeight()).toBe(3);
  });

  it('PATCH /predictions/:id updates consensus mode', async () => {
    const sim = repo.createSimulation('Consensus test');
    repo.updateMatchResult(sim.id, 1, 2, 1, null);
    const prediction = repo.createPrediction('Mode test', `${sim.id}-${sim.id}`);

    const res = await app.request(`/api/v1/predictions/${prediction.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consensusMode: 'outcome' }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ consensusMode: string }>(res);
    expect(body.consensusMode).toBe('outcome');

    const master = await json<{ consensusMode: string }>(
      await app.request(`/api/v1/master/group-state?predictionId=${prediction.id}`),
    );
    expect(master.consensusMode).toBe('outcome');
  });

  it('PATCH /predictions/:id/frozen-matches/:matchNumber/consensus-mode updates locked match', async () => {
    const sim = repo.createSimulation('Locked consensus');
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    const prediction = repo.createPrediction('Locked pool', `${sim.id}-${sim.id}`);
    repo.setPredictionConsensusMode(prediction.id, 'floor');

    await app.request('/api/v1/actual-results/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 2, goalsAway: 0 }),
    });

    const res = await app.request(
      `/api/v1/predictions/${prediction.id}/frozen-matches/1/consensus-mode`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consensusMode: 'scoreline' }),
      },
    );
    expect(res.status).toBe(200);
    const master = await json<{
      distributions: Record<string, { consensusMode?: string }>;
      resolvedMatches: Array<{ fixture: { matchNumber: number }; result: { goalsHome: number | null } }>;
    }>(res);
    expect(master.distributions['1']?.consensusMode).toBe('scoreline');
    expect(master.resolvedMatches.find((m) => m.fixture.matchNumber === 1)?.result.goalsHome).not.toBeNull();
  });

  it('POST /predictions/:id/sample samples and persists scores', async () => {
    const sim1 = repo.createSimulation('Sample API A');
    const sim2 = repo.createSimulation('Sample API B');
    repo.updateMatchResult(sim1.id, 1, 1, 0, 18);
    repo.updateMatchResult(sim2.id, 1, 0, 1, 19);
    const prediction = repo.createPrediction('Sample API', `${sim1.id}-${sim2.id}`);

    const res = await app.request(`/api/v1/predictions/${prediction.id}/sample`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const master = await json<{
      sample?: { matchCount: number; sampledAt: string };
      resolvedMatches: Array<{
        fixture: { matchNumber: number };
        result: { goalsHome: number | null; goalsAway: number | null; status: string };
      }>;
    }>(res);
    expect(master.sample?.matchCount).toBeGreaterThan(0);
    const match = master.resolvedMatches.find((m) => m.fixture.matchNumber === 1)!;
    expect(match.result.status).toBe('played');
    expect(match.result.goalsHome).not.toBeNull();
  });

  it('POST /predictions/:id/sample returns 409 when pool is empty', async () => {
    const prediction = repo.createPrediction('Empty sample', '1-9999');
    const res = await app.request(`/api/v1/predictions/${prediction.id}/sample`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
  });

  function playAllGroupMatches(simulationId: number) {
    const fixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of fixtures) {
      repo.updateMatchResult(simulationId, f.matchNumber, 1, 0, f.teamHomeId);
    }
  }

  it('PUT /actual-results records score and applies to new simulation', async () => {
    const put = await app.request('/api/v1/actual-results/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 2, goalsAway: 1 }),
    });
    expect(put.status).toBe(200);
    const actual = await json<{ matchNumber: number; goalsHome: number }>(put);
    expect(actual.matchNumber).toBe(1);
    expect(actual.goalsHome).toBe(2);

    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'After actual' }),
    });
    const { id } = await json<{ id: number }>(create);
    const match = repo.getSimulationMatches(id).find((m) => m.matchNumber === 1)!;
    expect(match.status).toBe('played');
    expect(match.goalsHome).toBe(2);
  });

  it('DELETE /actual-results clears result', async () => {
    await app.request('/api/v1/actual-results/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 1, goalsAway: 0 }),
    });
    const del = await app.request('/api/v1/actual-results/1', { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect(repo.getActualResult(1)).toBeNull();
  });

  it('PUT simulation match on locked match returns 409', async () => {
    await app.request('/api/v1/actual-results/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 2, goalsAway: 1 }),
    });
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Locked' }),
    });
    const { id } = await json<{ id: number }>(create);
    const put = await app.request(`/api/v1/simulations/${id}/matches/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 0, goalsAway: 0 }),
    });
    expect(put.status).toBe(409);
    const body = await json<{ code: string }>(put);
    expect(body.code).toBe('match_locked');
  });

  it('GET /actual-results/state includes isLocked on resolved matches', async () => {
    await app.request('/api/v1/actual-results/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalsHome: 2, goalsAway: 1 }),
    });
    const res = await app.request('/api/v1/actual-results/state');
    expect(res.status).toBe(200);
    const body = await json<{
      resolvedMatches: Array<{ fixture: { matchNumber: number }; isLocked: boolean }>;
    }>(res);
    const m1 = body.resolvedMatches.find((m) => m.fixture.matchNumber === 1)!;
    const m2 = body.resolvedMatches.find((m) => m.fixture.matchNumber === 2)!;
    expect(m1.isLocked).toBe(true);
    expect(m2.isLocked).toBe(false);
  });

  it('POST /simulations/:id/simulate/group plays remaining group matches', async () => {
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Auto group' }),
    });
    const { id } = await json<{ id: number }>(create);

    const res = await app.request(`/api/v1/simulations/${id}/simulate/group`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await json<{
      simulationId: number;
      matchesPlayed: number;
      simulation: { phase: string };
    }>(res);
    expect(body.simulationId).toBe(id);
    expect(body.matchesPlayed).toBeGreaterThan(0);
    expect(body.simulation.phase).toBe('g3');
  });

  it('POST /simulate/group auto-selects empty simulation', async () => {
    const res = await app.request('/api/v1/simulate/group', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await json<{ matchesPlayed: number; simulation: { id: number } }>(res);
    expect(body.matchesPlayed).toBeGreaterThan(0);
    expect(body.simulation.id).toBeGreaterThan(0);
  });

  it('POST /simulations/:id/simulate/knockouts after group completes tournament', async () => {
    const sim = repo.createSimulation('Full auto');
    const groupRes = await app.request(`/api/v1/simulations/${sim.id}/simulate/group`, {
      method: 'POST',
    });
    expect(groupRes.status).toBe(200);

    const res = await app.request(`/api/v1/simulations/${sim.id}/simulate/knockouts`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await json<{
      matchesPlayed: number;
      simulation: { phase: string };
    }>(res);
    expect(body.matchesPlayed).toBeGreaterThan(0);
    expect(body.simulation.phase).toBe('complete');
  });

  it('POST /simulations/:id/simulate/group?games=1 plays only through MD7', async () => {
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'G1 test' }),
    });
    const { id } = await json<{ id: number }>(create);

    const res = await app.request(`/api/v1/simulations/${id}/simulate/group?games=1`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await json<{
      matchesPlayed: number;
      results: Array<{ matchNumber: number }>;
      simulation: { phase: string };
    }>(res);
    expect(body.matchesPlayed).toBe(24);
    expect(body.simulation.phase).toBe('g1');
    for (const r of body.results) {
      expect(r.matchNumber).toBeLessThanOrEqual(68);
    }
  });

  it('POST /simulations/:id/simulate/knockouts?through=quarter_final plays 28 matches', async () => {
    const sim = repo.createSimulation('Partial KO');
    await app.request(`/api/v1/simulations/${sim.id}/simulate/group`, { method: 'POST' });

    const res = await app.request(
      `/api/v1/simulations/${sim.id}/simulate/knockouts?through=quarter_final`,
      { method: 'POST' },
    );
    expect(res.status).toBe(200);
    const body = await json<{ matchesPlayed: number; roundsPlayed: number }>(res);
    expect(body.matchesPlayed).toBe(28);
    expect(body.roundsPlayed).toBe(3);
  });

  it('POST /simulations/:id/matches/:matchNumber/simulate plays one match', async () => {
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Single match' }),
    });
    const { id } = await json<{ id: number }>(create);

    const res = await app.request(`/api/v1/simulations/${id}/matches/1/simulate`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await json<{
      matchNumber: number;
      goalsHome: number;
      goalsAway: number;
      simulation: { phase: string };
    }>(res);
    expect(body.matchNumber).toBe(1);
    expect(body.goalsHome).toBeGreaterThanOrEqual(0);
    expect(body.goalsAway).toBeGreaterThanOrEqual(0);
    expect(body.simulation.phase).toBe('group');
  });

  it('POST simulate match returns 409 when already played', async () => {
    const create = await app.request('/api/v1/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Replay' }),
    });
    const { id } = await json<{ id: number }>(create);

    await app.request(`/api/v1/simulations/${id}/matches/1/simulate`, { method: 'POST' });
    const res = await app.request(`/api/v1/simulations/${id}/matches/1/simulate`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
  });
});
