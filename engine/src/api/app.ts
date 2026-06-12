import { Hono } from 'hono';
import type { Repository } from '../db/repository.js';
import { clearActualMatchResult, setActualMatchResult } from './actual-results.js';
import { ApiError, errorBody } from './errors.js';
import { clearMatchScore, setMatchScore } from './scoring.js';
import {
  createMonteCarloStream,
  parseMonteCarloCount,
  parseUpsetVariance,
  parseUpsetVarianceQuery,
  simulateMonteCarlo,
} from './monteCarlo.js';
import {
  parseGroupGamesParam,
  parseThroughRoundParam,
  simulateGroupPhase,
  simulateGroupPhaseAuto,
  simulateKnockouts,
  simulateMatch,
} from './simulate.js';
import {
  serializeActualResult,
  serializeMatch,
  serializeMasterGroupState,
  serializeMasterTeamStats,
  serializeTeam,
  serializeTournamentState,
} from './serialize.js';

export function createApiApp(repo: Repository) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(errorBody(err), err.status);
    }
    console.error(err);
    return c.json(errorBody(err), 500);
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/api/v1/actual-results', (c) =>
    c.json(repo.getActualResults().map(serializeActualResult)),
  );

  app.get('/api/v1/master/group-state', (c) => {
    const view = repo.buildMasterGroupView();
    return c.json(serializeMasterGroupState(view));
  });

  app.get('/api/v1/master/team-stats', (c) => {
    const stats = repo.buildMasterTeamStats();
    return c.json(serializeMasterTeamStats(stats));
  });

  app.post('/api/v1/master/team-stats/rebuild', (c) => {
    repo.rebuildAllMasterAggregates();
    const stats = repo.buildMasterTeamStats();
    return c.json(serializeMasterTeamStats(stats));
  });

  app.get('/api/v1/actual-results/state', (c) => {
    const view = repo.buildActualResultsView();
    return c.json({
      actualResults: view.actualResults.map(serializeActualResult),
      phase: view.phase,
      groupStandings: view.groupStandings,
      qualifyingThirdGroups: view.qualifyingThirdGroups,
      resolvedMatches: view.resolvedMatches.map((m) => ({
        fixture: m.fixture,
        result: serializeMatch(m.result),
        homeTeam: m.homeTeam ? serializeTeam(m.homeTeam) : null,
        awayTeam: m.awayTeam ? serializeTeam(m.awayTeam) : null,
        homeLabel: m.homeLabel,
        awayLabel: m.awayLabel,
        isLocked: m.isLocked,
      })),
    });
  });

  app.get('/api/v1/actual-results/:matchNumber', (c) => {
    const matchNumber = parseIntParam(c.req.param('matchNumber'));
    const result = repo.getActualResult(matchNumber);
    if (!result) throw new ApiError('Actual result not found', 404, 'actual_result_not_found');
    return c.json(serializeActualResult(result));
  });

  app.put('/api/v1/actual-results/:matchNumber', async (c) => {
    const matchNumber = parseIntParam(c.req.param('matchNumber'));
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new ApiError('Request body must be JSON', 400, 'invalid_body');
    }
    const result = setActualMatchResult(repo, matchNumber, {
      goalsHome: (body as { goalsHome: unknown }).goalsHome,
      goalsAway: (body as { goalsAway: unknown }).goalsAway,
      winnerTeamId: (body as { winnerTeamId?: unknown }).winnerTeamId as number | null | undefined,
    });
    return c.json(serializeActualResult(result));
  });

  app.delete('/api/v1/actual-results/:matchNumber', (c) => {
    const matchNumber = parseIntParam(c.req.param('matchNumber'));
    clearActualMatchResult(repo, matchNumber);
    return c.body(null, 204);
  });

  app.get('/api/v1/simulations', (c) => {
    const page = parsePositiveIntQuery(c.req.query('page'), 1);
    const pageSize = Math.min(parsePositiveIntQuery(c.req.query('pageSize'), 50), 100);
    return c.json(repo.listSimulationsWithCountsPage(page, pageSize));
  });

  app.post('/api/v1/simulations', async (c) => {
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name : 'Simulation';
    const simulation = repo.createSimulation(name);
    return c.json(simulation, 201);
  });

  app.patch('/api/v1/simulations/:id', async (c) => {
    const id = parseIntParam(c.req.param('id'));
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name : '';
    if (!name.trim()) {
      throw new ApiError('name is required', 400, 'invalid_body');
    }
    const simulation = repo.updateSimulationName(id, name);
    if (!simulation) {
      throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    }
    return c.json(simulation);
  });

  app.delete('/api/v1/simulations/:id', (c) => {
    const id = parseIntParam(c.req.param('id'));
    if (!repo.deleteSimulation(id)) {
      throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    }
    return c.body(null, 204);
  });

  app.post('/api/v1/simulations/:id/activate', (c) => {
    const id = parseIntParam(c.req.param('id'));
    if (!repo.getSimulation(id)) {
      throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    }
    repo.touchSimulation(id);
    return c.json(repo.getSimulation(id));
  });

  app.get('/api/v1/teams', (c) => {
    return c.json(repo.getTeams().map(serializeTeam));
  });

  app.patch('/api/v1/teams/:id', async (c) => {
    const id = parseIntParam(c.req.param('id'), true);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new ApiError('Request body must be JSON', 400, 'invalid_body');
    }
    const offensiveRating = (body as { offensiveRating: unknown }).offensiveRating;
    const defensiveRating = (body as { defensiveRating: unknown }).defensiveRating;
    if (typeof offensiveRating !== 'number' || typeof defensiveRating !== 'number') {
      throw new ApiError('offensiveRating and defensiveRating must be numbers', 400, 'invalid_body');
    }
    const team = repo.updateTeamRatings(id, offensiveRating, defensiveRating);
    if (!team) {
      throw new ApiError('Team not found or invalid ratings', 404, 'team_not_found');
    }
    return c.json(serializeTeam(team));
  });

  app.get('/api/v1/simulations/:id', (c) => {
    const id = parseIntParam(c.req.param('id'));
    const simulation = repo.getSimulation(id);
    if (!simulation) throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    return c.json(simulation);
  });

  app.get('/api/v1/simulations/:id/matches', (c) => {
    const id = parseIntParam(c.req.param('id'));
    if (!repo.getSimulation(id)) {
      throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    }
    const matches = repo.getSimulationMatches(id).map(serializeMatch);
    return c.json(matches);
  });

  app.get('/api/v1/simulations/:id/matches/:matchNumber', (c) => {
    const id = parseIntParam(c.req.param('id'));
    const matchNumber = parseIntParam(c.req.param('matchNumber'));
    if (!repo.getSimulation(id)) {
      throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    }
    const match = repo.getSimulationMatches(id).find((m) => m.matchNumber === matchNumber);
    if (!match) throw new ApiError('Match not found', 404, 'match_not_found');
    return c.json(serializeMatch(match));
  });

  app.get('/api/v1/simulations/:id/state', (c) => {
    const id = parseIntParam(c.req.param('id'));
    const state = repo.buildTournamentState(id);
    if (!state) throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    return c.json(serializeTournamentState(state));
  });

  app.put('/api/v1/simulations/:id/matches/:matchNumber', async (c) => {
    const id = parseIntParam(c.req.param('id'));
    const matchNumber = parseIntParam(c.req.param('matchNumber'));
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new ApiError('Request body must be JSON', 400, 'invalid_body');
    }
    const result = setMatchScore(repo, id, matchNumber, {
      goalsHome: (body as { goalsHome: unknown }).goalsHome,
      goalsAway: (body as { goalsAway: unknown }).goalsAway,
      winnerTeamId: (body as { winnerTeamId?: unknown }).winnerTeamId as number | null | undefined,
    });
    return c.json(result);
  });

  app.delete('/api/v1/simulations/:id/matches/:matchNumber', (c) => {
    const id = parseIntParam(c.req.param('id'));
    const matchNumber = parseIntParam(c.req.param('matchNumber'));
    const result = clearMatchScore(repo, id, matchNumber);
    return c.json(result);
  });

  app.post('/api/v1/simulate/monte-carlo', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new ApiError('Request body must be JSON', 400, 'invalid_body');
    }
    const count = parseMonteCarloCount((body as { count: unknown }).count);
    const upsetVariance = parseUpsetVariance((body as { upsetVariance?: unknown }).upsetVariance);
    const stream = (body as { stream?: unknown }).stream === true;
    if (stream) {
      return new Response(createMonteCarloStream(repo, count, upsetVariance), {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      });
    }
    return c.json(await simulateMonteCarlo(repo, count, upsetVariance));
  });

  app.post('/api/v1/simulate/group', (c) => {
    const games = parseGroupGamesParam(c.req.query('games'));
    const upsetVariance = parseUpsetVarianceQuery(c.req.query('upsetVariance'));
    const result = simulateGroupPhaseAuto(repo, games, upsetVariance);
    return c.json(result);
  });

  app.post('/api/v1/simulations/:id/simulate/group', (c) => {
    const id = parseIntParam(c.req.param('id'));
    if (!repo.getSimulation(id)) {
      throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    }
    const games = parseGroupGamesParam(c.req.query('games'));
    const upsetVariance = parseUpsetVarianceQuery(c.req.query('upsetVariance'));
    const result = simulateGroupPhase(repo, id, games, upsetVariance);
    return c.json(result);
  });

  app.post('/api/v1/simulations/:id/simulate/knockouts', (c) => {
    const id = parseIntParam(c.req.param('id'));
    if (!repo.getSimulation(id)) {
      throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    }
    const through = parseThroughRoundParam(c.req.query('through'));
    const upsetVariance = parseUpsetVarianceQuery(c.req.query('upsetVariance'));
    const result = simulateKnockouts(repo, id, through, upsetVariance);
    return c.json(result);
  });

  app.post('/api/v1/simulations/:id/matches/:matchNumber/simulate', (c) => {
    const id = parseIntParam(c.req.param('id'));
    const matchNumber = parseIntParam(c.req.param('matchNumber'));
    if (!repo.getSimulation(id)) {
      throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    }
    const upsetVariance = parseUpsetVarianceQuery(c.req.query('upsetVariance'));
    const result = simulateMatch(repo, id, matchNumber, upsetVariance);
    return c.json(result);
  });

  return app;
}

function parseIntParam(value: string, allowZero = false): number {
  const n = parseInt(value, 10);
  const min = allowZero ? 0 : 1;
  if (!Number.isFinite(n) || n < min) {
    throw new ApiError('Invalid id parameter', 400, 'invalid_param');
  }
  return n;
}

function parsePositiveIntQuery(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new ApiError('Invalid query parameter', 400, 'invalid_param');
  }
  return n;
}
