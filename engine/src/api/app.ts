import { FrozenMatchError } from '../db/errors.js';
import { PredictionSampleError } from '../db/predictionSample.js';
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
import { parseRatingEloWeight } from './ratingEloWeight.js';
import { parseTournamentEloDeltaWeight } from './tournamentEloDeltaWeight.js';
import { parseConsensusModeBody } from './consensusMode.js';
import {
  parseKnockoutRoundName,
  parsePredictionKnockoutCount,
  parseResimulateFlag,
  parseThirdPlaceOrderBody,
} from './predictionKnockout.js';
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
  serializeMasterKnockoutState,
  serializeMasterTeamStats,
  serializeTeam,
  serializeTournamentState,
} from './serialize.js';
import { writePublicSnapshot } from '../export/writePublicSnapshot.js';

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

  app.post('/api/v1/export/public', (c) => {
    try {
      return c.json(writePublicSnapshot(repo));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      if (message.includes('No predictions configured')) {
        throw new ApiError(message, 404, 'prediction_not_found');
      }
      throw err;
    }
  });

  app.get('/api/v1/actual-results', (c) =>
    c.json(repo.getActualResults().map(serializeActualResult)),
  );

  app.get('/api/v1/master/knockout-state', (c) => {
    const predictionId = resolvePredictionIdParam(c.req.query('predictionId'), repo);
    if (predictionId == null) {
      throw new ApiError('No predictions configured', 404, 'prediction_not_found');
    }
    const view = repo.buildMasterKnockoutView(predictionId);
    return c.json(serializeMasterKnockoutState(view));
  });

  app.get('/api/v1/master/group-state', (c) => {
    const predictionId = resolvePredictionIdParam(c.req.query('predictionId'), repo);
    if (predictionId == null) {
      throw new ApiError('No predictions configured', 404, 'prediction_not_found');
    }
    const view = repo.buildMasterGroupView(predictionId);
    return c.json(serializeMasterGroupState(view));
  });

  app.get('/api/v1/master/team-stats', (c) => {
    const predictionId = resolvePredictionIdParam(c.req.query('predictionId'), repo);
    if (predictionId == null) {
      throw new ApiError('No predictions configured', 404, 'prediction_not_found');
    }
    const stats = repo.buildMasterTeamStats(predictionId);
    return c.json(serializeMasterTeamStats(stats));
  });

  app.post('/api/v1/master/team-stats/rebuild', (c) => {
    const predictionId = resolvePredictionIdParam(c.req.query('predictionId'), repo);
    repo.rebuildAllPredictionAggregates();
    if (predictionId == null) {
      throw new ApiError('No predictions configured', 404, 'prediction_not_found');
    }
    const stats = repo.buildMasterTeamStats(predictionId);
    return c.json(serializeMasterTeamStats(stats));
  });

  app.get('/api/v1/predictions', (c) => {
    const page = parsePositiveIntQuery(c.req.query('page'), 1);
    const pageSize = Math.min(parsePositiveIntQuery(c.req.query('pageSize'), 50), 100);
    return c.json(repo.listPredictionsPage(page, pageSize));
  });

  app.post('/api/v1/predictions/validate-selection', async (c) => {
    const body = await c.req.json().catch(() => null);
    const selection = typeof body?.selection === 'string' ? body.selection : '';
    const result = repo.validateSelection(selection);
    if ('error' in result) {
      throw new ApiError(result.error, 400, 'invalid_selection');
    }
    return c.json(result);
  });

  app.post('/api/v1/predictions', async (c) => {
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name : 'Prediction';
    const selection = typeof body?.selection === 'string' ? body.selection : '';
    if (!selection.trim()) {
      throw new ApiError('selection is required', 400, 'invalid_body');
    }
    try {
      const prediction = repo.createPrediction(name, selection);
      return c.json(serializePrediction(prediction), 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid selection';
      throw new ApiError(message, 400, 'invalid_selection');
    }
  });

  app.patch('/api/v1/predictions/:id', async (c) => {
    const id = parseIntParam(c.req.param('id'));
    const body = await c.req.json().catch(() => null);
    const hasName = typeof body?.name === 'string';
    const hasConsensusMode = body?.consensusMode != null;
    if (!hasName && !hasConsensusMode) {
      throw new ApiError('name or consensusMode is required', 400, 'invalid_body');
    }

    let prediction = repo.getPrediction(id);
    if (!prediction) {
      throw new ApiError('Prediction not found', 404, 'prediction_not_found');
    }

    if (hasName) {
      const renamed = repo.renamePrediction(id, body.name);
      if (!renamed) {
        throw new ApiError('name is required', 400, 'invalid_body');
      }
      prediction = renamed;
    }

    if (hasConsensusMode) {
      const mode = parseConsensusModeBody(body.consensusMode);
      const updated = repo.setPredictionConsensusMode(id, mode);
      if (!updated) {
        throw new ApiError('Prediction not found', 404, 'prediction_not_found');
      }
      prediction = updated;
    }

    return c.json(serializePrediction(prediction));
  });

  app.delete('/api/v1/predictions/:id', (c) => {
    const id = parseIntParam(c.req.param('id'));
    if (!repo.deletePrediction(id)) {
      throw new ApiError('Prediction not found', 404, 'prediction_not_found');
    }
    return c.body(null, 204);
  });

  app.post('/api/v1/predictions/:id/activate', (c) => {
    const id = parseIntParam(c.req.param('id'));
    const prediction = repo.touchPrediction(id);
    if (!prediction) {
      throw new ApiError('Prediction not found', 404, 'prediction_not_found');
    }
    return c.json(serializePrediction(prediction));
  });

  app.get('/api/v1/predictions/:id/group-state', (c) => {
    const id = parseIntParam(c.req.param('id'));
    if (!repo.getPrediction(id)) {
      throw new ApiError('Prediction not found', 404, 'prediction_not_found');
    }
    const view = repo.buildMasterGroupView(id);
    return c.json(serializeMasterGroupState(view));
  });

  app.patch('/api/v1/predictions/:id/frozen-matches/:matchNumber/consensus-mode', async (c) => {
    const id = parseIntParam(c.req.param('id'));
    const matchNumber = parseIntParam(c.req.param('matchNumber'));
    const body = await c.req.json().catch(() => null);
    if (!body || body.consensusMode == null) {
      throw new ApiError('consensusMode is required', 400, 'invalid_body');
    }
    const mode = parseConsensusModeBody(body.consensusMode);
    try {
      const view = repo.setFrozenMatchConsensusMode(id, matchNumber, mode);
      return c.json(serializeMasterGroupState(view));
    } catch (err) {
      if (err instanceof FrozenMatchError) {
        throw new ApiError(err.message, 409, 'frozen_match_error');
      }
      throw err;
    }
  });

  app.post('/api/v1/predictions/:id/sample', (c) => {
    const id = parseIntParam(c.req.param('id'));
    if (!repo.getPrediction(id)) {
      throw new ApiError('Prediction not found', 404, 'prediction_not_found');
    }
    try {
      const view = repo.performPredictionSample(id);
      return c.json(serializeMasterGroupState(view));
    } catch (err) {
      if (err instanceof PredictionSampleError) {
        throw new ApiError(err.message, 409, 'no_sample_eligible_matches');
      }
      throw err;
    }
  });

  app.post('/api/v1/predictions/:id/sample/:matchNumber', (c) => {
    const id = parseIntParam(c.req.param('id'));
    const matchNumber = parseIntParam(c.req.param('matchNumber'));
    if (!repo.getPrediction(id)) {
      throw new ApiError('Prediction not found', 404, 'prediction_not_found');
    }
    try {
      const view = repo.performPredictionSampleMatch(id, matchNumber);
      return c.json(serializeMasterGroupState(view));
    } catch (err) {
      if (err instanceof PredictionSampleError) {
        throw new ApiError(err.message, 409, 'no_sample_eligible_matches');
      }
      throw err;
    }
  });

  app.post('/api/v1/predictions/:id/knockout/simulate-round', async (c) => {
    const id = parseIntParam(c.req.param('id'));
    if (!repo.getPrediction(id)) {
      throw new ApiError('Prediction not found', 404, 'prediction_not_found');
    }
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new ApiError('Request body must be JSON', 400, 'invalid_body');
    }
    const round = parseKnockoutRoundName((body as { round?: unknown }).round);
    const count = parsePredictionKnockoutCount((body as { count?: unknown }).count);
    const upsetVariance = parseUpsetVariance((body as { upsetVariance?: unknown }).upsetVariance);
    const ratingEloWeightRaw = (body as { ratingEloWeight?: unknown }).ratingEloWeight;
    const tournamentEloDeltaWeightRaw = (body as { tournamentEloDeltaWeight?: unknown })
      .tournamentEloDeltaWeight;
    const ratingEloWeight =
      ratingEloWeightRaw === undefined ? undefined : parseRatingEloWeight(ratingEloWeightRaw);
    const tournamentEloDeltaWeight =
      tournamentEloDeltaWeightRaw === undefined
        ? undefined
        : parseTournamentEloDeltaWeight(tournamentEloDeltaWeightRaw);
    const resimulate = parseResimulateFlag((body as { resimulate?: unknown }).resimulate);
    try {
      const view = repo.simulatePredictionKnockoutRoundForPrediction(id, round, {
        count,
        upsetVariance,
        ratingEloWeight,
        tournamentEloDeltaWeight,
        resimulate,
      });
      return c.json(serializeMasterKnockoutState(view));
    } catch (err) {
      if (err instanceof RangeError) {
        throw new ApiError(err.message, 400, 'invalid_body');
      }
      if (err instanceof Error) {
        throw new ApiError(err.message, 409, 'knockout_simulate_error');
      }
      throw err;
    }
  });

  app.put('/api/v1/actual-results/third-place-order', async (c) => {
    const body = await c.req.json().catch(() => null);
    const order = parseThirdPlaceOrderBody(body);
    try {
      const view = repo.setActualThirdPlaceOrder(order);
      return c.json({
        actualResults: view.actualResults.map(serializeActualResult),
        phase: view.phase,
        groupStandings: view.groupStandings,
        qualifyingThirdGroups: view.qualifyingThirdGroups,
        thirdPlaceOrder: view.thirdPlaceOrder.map((row) => ({
          groupLetter: row.groupLetter,
          position: row.position,
          teamId: row.teamId,
          team: serializeTeam(row.team),
          points: row.points,
          goalDifference: row.goalDifference,
          goalsFor: row.goalsFor,
          qualified: row.qualified,
        })),
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid third-place order';
      throw new ApiError(message, 400, 'invalid_body');
    }
  });

  app.put('/api/v1/predictions/:id/third-place-order', async (c) => {
    throw new ApiError(
      'Third-place order is managed from the Results view',
      410,
      'third_place_order_moved',
    );
  });

  app.post('/api/v1/predictions/:id/knockout/clear', (c) => {
    const id = parseIntParam(c.req.param('id'));
    if (!repo.getPrediction(id)) {
      throw new ApiError('Prediction not found', 404, 'prediction_not_found');
    }
    const view = repo.clearPredictionKnockout(id);
    return c.json(serializeMasterKnockoutState(view));
  });

  app.get('/api/v1/predictions/:id/team-stats', (c) => {
    const id = parseIntParam(c.req.param('id'));
    if (!repo.getPrediction(id)) {
      throw new ApiError('Prediction not found', 404, 'prediction_not_found');
    }
    const stats = repo.buildMasterTeamStats(id);
    return c.json(serializeMasterTeamStats(stats));
  });

  app.get('/api/v1/actual-results/state', (c) => {
    const view = repo.buildActualResultsView();
    return c.json({
      actualResults: view.actualResults.map(serializeActualResult),
      phase: view.phase,
      groupStandings: view.groupStandings,
      qualifyingThirdGroups: view.qualifyingThirdGroups,
      thirdPlaceOrder: view.thirdPlaceOrder.map((row) => ({
        groupLetter: row.groupLetter,
        position: row.position,
        teamId: row.teamId,
        team: serializeTeam(row.team),
        points: row.points,
        goalDifference: row.goalDifference,
        goalsFor: row.goalsFor,
        qualified: row.qualified,
      })),
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

  app.get('/api/v1/settings/rating-elo-weight', (c) => {
    return c.json({ ratingEloWeight: repo.getRatingEloWeight() });
  });

  app.put('/api/v1/settings/rating-elo-weight', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new ApiError('Request body must be JSON', 400, 'invalid_body');
    }
    const ratingEloWeight = parseRatingEloWeight(
      (body as { ratingEloWeight: unknown }).ratingEloWeight,
    );
    repo.setRatingEloWeight(ratingEloWeight);
    return c.json({ ratingEloWeight });
  });

  app.get('/api/v1/settings/tournament-elo-delta-weight', (c) => {
    return c.json({ tournamentEloDeltaWeight: repo.getTournamentEloDeltaWeight() });
  });

  app.put('/api/v1/settings/tournament-elo-delta-weight', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new ApiError('Request body must be JSON', 400, 'invalid_body');
    }
    const tournamentEloDeltaWeight = parseTournamentEloDeltaWeight(
      (body as { tournamentEloDeltaWeight: unknown }).tournamentEloDeltaWeight,
    );
    repo.setTournamentEloDeltaWeight(tournamentEloDeltaWeight);
    return c.json({ tournamentEloDeltaWeight });
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

function resolvePredictionIdParam(
  value: string | undefined,
  repo: Repository,
): number | null {
  if (value == null || value === '') {
    return repo.resolvePredictionId();
  }
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new ApiError('Invalid predictionId parameter', 400, 'invalid_param');
  }
  return repo.resolvePredictionId(n);
}

function serializePrediction(prediction: NonNullable<ReturnType<Repository['getPrediction']>>) {
  return {
    id: prediction.id,
    name: prediction.name,
    selectionSpec: prediction.selectionSpec,
    consensusMode: prediction.consensusMode,
    createdAt: prediction.createdAt,
    updatedAt: prediction.updatedAt,
  };
}
