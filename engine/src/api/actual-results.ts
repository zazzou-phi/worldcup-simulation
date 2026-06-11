import type { Repository } from '../db/repository.js';
import { ActualResultError, MatchLockedError } from '../db/errors.js';
import type { ActualMatchResult } from '../engine/types.js';
import { ApiError } from './errors.js';
import type { SetScoreInput } from './scoring.js';
import { resolveWinnerTeamId } from './scoring.js';

function toApiError(err: unknown): never {
  if (err instanceof MatchLockedError) {
    throw new ApiError(err.message, 409, 'match_locked');
  }
  if (err instanceof ActualResultError) {
    throw new ApiError(err.message, 409, 'actual_result_error');
  }
  throw err;
}

function parseNonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ApiError(`${field} must be a non-negative integer`, 400, 'invalid_score');
  }
  return value;
}

function parseOptionalTeamId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError('winnerTeamId must be a positive integer', 400, 'invalid_winner');
  }
  return value;
}

export function setActualMatchResult(
  repo: Repository,
  matchNumber: number,
  input: SetScoreInput,
): ActualMatchResult {
  const goalsHome = parseNonNegativeInt(input.goalsHome, 'goalsHome');
  const goalsAway = parseNonNegativeInt(input.goalsAway, 'goalsAway');

  const view = repo.buildActualResultsView();
  const resolved = view.resolvedMatches.find((m) => m.fixture.matchNumber === matchNumber);
  if (!resolved) {
    throw new ApiError('Match not found', 404, 'match_not_found');
  }

  let winnerInput: number | null | undefined = undefined;
  if (input.winnerTeamId !== undefined) {
    winnerInput =
      input.winnerTeamId === null ? null : parseOptionalTeamId(input.winnerTeamId);
  }
  const winnerTeamId = resolveWinnerTeamId(resolved, goalsHome, goalsAway, winnerInput);

  try {
    return repo.setActualResult(matchNumber, goalsHome, goalsAway, winnerTeamId);
  } catch (err) {
    toApiError(err);
  }
}

export function clearActualMatchResult(repo: Repository, matchNumber: number): void {
  try {
    repo.clearActualResult(matchNumber);
  } catch (err) {
    toApiError(err);
  }
}
