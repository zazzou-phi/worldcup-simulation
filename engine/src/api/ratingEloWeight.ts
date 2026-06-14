import type { RatingEloWeight } from '../engine/types.js';
import { ApiError } from './errors.js';

export const DEFAULT_RATING_ELO_WEIGHT: RatingEloWeight = 0.65;

export function parseRatingEloWeight(value: unknown): RatingEloWeight {
  if (value == null || value === '') return DEFAULT_RATING_ELO_WEIGHT;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError('ratingEloWeight must be a number between 0 and 1', 400, 'invalid_body');
  }
  if (value < 0 || value > 1) {
    throw new ApiError('ratingEloWeight must be between 0 and 1', 400, 'invalid_body');
  }
  return value;
}

export function parseRatingEloWeightQuery(value: string | undefined): RatingEloWeight {
  if (value == null || value === '') return DEFAULT_RATING_ELO_WEIGHT;
  const parsed = Number(value);
  return parseRatingEloWeight(parsed);
}
