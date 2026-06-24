import { SIMULATION_KNOCKOUT_ROUNDS } from '../engine/simulationRounds.js';
import { PREDICTION_KNOCKOUT_MC_COUNT } from '../engine/predictionKnockout.js';
import { ApiError } from './errors.js';

const VALID_ROUNDS = new Set(SIMULATION_KNOCKOUT_ROUNDS.map((round) => round.name));

export function parseKnockoutRoundName(value: unknown): string {
  if (typeof value !== 'string' || !VALID_ROUNDS.has(value)) {
    throw new ApiError(
      `round must be one of: ${[...VALID_ROUNDS].join(', ')}`,
      400,
      'invalid_body',
    );
  }
  return value;
}

export function parsePredictionKnockoutCount(value: unknown): number {
  if (value === undefined || value === null) {
    return PREDICTION_KNOCKOUT_MC_COUNT;
  }
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new ApiError('count must be an integer', 400, 'invalid_body');
  }
  if (parsed < 1 || parsed > 100_000) {
    throw new ApiError('count must be between 1 and 100000', 400, 'invalid_body');
  }
  return parsed;
}

export function parseResimulateFlag(value: unknown): boolean {
  return value === true;
}

export function parseThirdPlaceOrderBody(body: unknown): Array<{ groupLetter: string; position: number }> {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { order?: unknown }).order)) {
    throw new ApiError('order must be an array of { groupLetter, position }', 400, 'invalid_body');
  }
  const order = (body as { order: unknown[] }).order;
  return order.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new ApiError(`order[${index}] must be an object`, 400, 'invalid_body');
    }
    const groupLetter = (entry as { groupLetter?: unknown }).groupLetter;
    const position = (entry as { position?: unknown }).position;
    if (typeof groupLetter !== 'string' || !/^[A-L]$/.test(groupLetter)) {
      throw new ApiError(`order[${index}].groupLetter must be A-L`, 400, 'invalid_body');
    }
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 1) {
      throw new ApiError(`order[${index}].position must be a positive integer`, 400, 'invalid_body');
    }
    return { groupLetter, position };
  });
}
