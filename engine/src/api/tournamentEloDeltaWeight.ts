import {
  DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT,
  TOURNAMENT_ELO_DELTA_WEIGHT_MAX,
} from '../engine/tournamentElo.js';
import type { TournamentEloDeltaWeight } from '../engine/types.js';
import { ApiError } from './errors.js';

export { DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT, TOURNAMENT_ELO_DELTA_WEIGHT_MAX };

export function parseTournamentEloDeltaWeight(value: unknown): TournamentEloDeltaWeight {
  if (value == null || value === '') return DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError(
      'tournamentEloDeltaWeight must be a number between 0 and 5',
      400,
      'invalid_body',
    );
  }
  if (value < 0 || value > TOURNAMENT_ELO_DELTA_WEIGHT_MAX) {
    throw new ApiError(
      'tournamentEloDeltaWeight must be between 0 and 5',
      400,
      'invalid_body',
    );
  }
  return value;
}
