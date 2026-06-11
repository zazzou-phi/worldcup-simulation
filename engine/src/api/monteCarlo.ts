import type { Repository } from '../db/repository.js';
import { DEFAULT_UPSET_VARIANCE } from '../engine/matchSimulator.js';
import { MONTE_CARLO_MAX_COUNT, runMonteCarlo, type MonteCarloResult } from '../simulation/monteCarlo.js';
import { ApiError } from './errors.js';

export const UPSET_VARIANCE_MAX = 5;

export function parseMonteCarloCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ApiError('count must be an integer', 400, 'invalid_body');
  }
  if (value < 1 || value > MONTE_CARLO_MAX_COUNT) {
    throw new ApiError(
      `count must be between 1 and ${MONTE_CARLO_MAX_COUNT}`,
      400,
      'invalid_body',
    );
  }
  return value;
}

export function parseUpsetVariance(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_UPSET_VARIANCE;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError('upsetVariance must be a number', 400, 'invalid_body');
  }
  if (value < 0 || value > UPSET_VARIANCE_MAX) {
    throw new ApiError(
      `upsetVariance must be between 0 and ${UPSET_VARIANCE_MAX}`,
      400,
      'invalid_body',
    );
  }
  return value;
}

export async function simulateMonteCarlo(
  repo: Repository,
  count: number,
  upsetVariance?: number,
): Promise<MonteCarloResult> {
  try {
    return await runMonteCarlo(repo, count, { upsetVariance });
  } catch (err) {
    if (err instanceof RangeError) {
      throw new ApiError(err.message, 400, 'invalid_body');
    }
    throw err;
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export type MonteCarloStreamEvent =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'result'; result: MonteCarloResult }
  | { type: 'error'; message: string };

export function createMonteCarloStream(
  repo: Repository,
  count: number,
  upsetVariance?: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const enqueue = (event: MonteCarloStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const result = await runMonteCarlo(repo, count, {
          upsetVariance,
          onProgress: async (completed, total) => {
            enqueue({ type: 'progress', completed, total });
            await yieldToEventLoop();
          },
        });
        enqueue({ type: 'result', result });
        controller.close();
      } catch (err) {
        const message =
          err instanceof RangeError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Bulk simulation failed';
        enqueue({ type: 'error', message });
        controller.close();
      }
    },
  });
}
