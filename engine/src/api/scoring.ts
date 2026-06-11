import type { Repository } from '../db/repository.js';
import { MatchLockedError } from '../db/errors.js';
import type { ResolvedMatch, Simulation, SimulationMatch } from '../engine/types.js';
import { ApiError } from './errors.js';

export interface SetScoreInput {
  goalsHome: unknown;
  goalsAway: unknown;
  winnerTeamId?: unknown;
}

export interface SetScoreResult {
  match: Omit<SimulationMatch, 'simulationId'>;
  simulation: Simulation;
}

function parseOptionalTeamId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError('winnerTeamId must be a positive integer', 400, 'invalid_winner');
  }
  return value;
}

function parseNonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ApiError(`${field} must be a non-negative integer`, 400, 'invalid_score');
  }
  return value;
}

function findResolvedMatch(
  repo: Repository,
  simulationId: number,
  matchNumber: number,
): ResolvedMatch {
  const state = repo.buildTournamentState(simulationId);
  if (!state) {
    throw new ApiError('Simulation not found', 404, 'simulation_not_found');
  }
  const resolved = state.resolvedMatches.find((m) => m.fixture.matchNumber === matchNumber);
  if (!resolved) {
    throw new ApiError('Match not found', 404, 'match_not_found');
  }
  return resolved;
}

export function resolveWinnerTeamId(
  resolved: ResolvedMatch,
  goalsHome: number,
  goalsAway: number,
  winnerTeamId: number | null | undefined,
): number | null {
  const { homeTeam, awayTeam, fixture } = resolved;
  const isKnockout = fixture.group == null;

  if (isKnockout && (homeTeam == null || awayTeam == null)) {
    throw new ApiError(
      'Match participants are not yet determined; complete upstream matches first',
      409,
      'match_not_ready',
    );
  }

  if (isKnockout && goalsHome === goalsAway) {
    if (winnerTeamId == null) {
      throw new ApiError(
        'Knockout ties require winnerTeamId (home or away team id)',
        400,
        'winner_required',
      );
    }
    const homeId = homeTeam!.id;
    const awayId = awayTeam!.id;
    if (winnerTeamId !== homeId && winnerTeamId !== awayId) {
      throw new ApiError(
        'winnerTeamId must be the resolved home or away team',
        400,
        'invalid_winner',
      );
    }
    return winnerTeamId;
  }

  if (goalsHome > goalsAway) {
    const derived = homeTeam?.id ?? null;
    if (
      winnerTeamId != null &&
      derived != null &&
      winnerTeamId !== derived
    ) {
      throw new ApiError('winnerTeamId does not match the goal difference', 400, 'invalid_winner');
    }
    return derived;
  }
  if (goalsAway > goalsHome) {
    const derived = awayTeam?.id ?? null;
    if (
      winnerTeamId != null &&
      derived != null &&
      winnerTeamId !== derived
    ) {
      throw new ApiError('winnerTeamId does not match the goal difference', 400, 'invalid_winner');
    }
    return derived;
  }

  return null;
}

export function setMatchScore(
  repo: Repository,
  simulationId: number,
  matchNumber: number,
  input: SetScoreInput,
): SetScoreResult {
  if (!repo.getSimulation(simulationId)) {
    throw new ApiError('Simulation not found', 404, 'simulation_not_found');
  }

  const goalsHome = parseNonNegativeInt(input.goalsHome, 'goalsHome');
  const goalsAway = parseNonNegativeInt(input.goalsAway, 'goalsAway');

  const resolved = findResolvedMatch(repo, simulationId, matchNumber);
  let winnerInput: number | null | undefined = undefined;
  if (input.winnerTeamId !== undefined) {
    winnerInput =
      input.winnerTeamId === null ? null : parseOptionalTeamId(input.winnerTeamId);
  }
  const winnerTeamId = resolveWinnerTeamId(resolved, goalsHome, goalsAway, winnerInput);

  try {
    repo.updateMatchResult(simulationId, matchNumber, goalsHome, goalsAway, winnerTeamId);
  } catch (err) {
    if (err instanceof MatchLockedError) {
      throw new ApiError(err.message, 409, 'match_locked');
    }
    throw err;
  }

  const state = repo.buildTournamentState(simulationId)!;
  const match = state.matches.find((m) => m.matchNumber === matchNumber)!;
  const { simulationId: _sid, ...matchOut } = match;

  return {
    match: matchOut,
    simulation: state.simulation,
  };
}

export function clearMatchScore(
  repo: Repository,
  simulationId: number,
  matchNumber: number,
): SetScoreResult {
  if (!repo.getSimulation(simulationId)) {
    throw new ApiError('Simulation not found', 404, 'simulation_not_found');
  }

  const matches = repo.getSimulationMatches(simulationId);
  if (!matches.some((m) => m.matchNumber === matchNumber)) {
    throw new ApiError('Match not found', 404, 'match_not_found');
  }

  try {
    repo.clearMatchResult(simulationId, matchNumber);
  } catch (err) {
    if (err instanceof MatchLockedError) {
      throw new ApiError(err.message, 409, 'match_locked');
    }
    throw err;
  }

  const state = repo.buildTournamentState(simulationId)!;
  const match = state.matches.find((m) => m.matchNumber === matchNumber)!;
  const { simulationId: _sid, ...matchOut } = match;

  return {
    match: matchOut,
    simulation: state.simulation,
  };
}
