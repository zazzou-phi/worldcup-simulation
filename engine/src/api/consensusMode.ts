import type { ConsensusMode } from '../engine/consensus.js';
import { ApiError } from './errors.js';

const VALID_MODES = new Set<ConsensusMode>(['expected', 'outcome', 'scoreline', 'rounded', 'draw']);

export function parseConsensusModeBody(value: unknown): ConsensusMode {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError('consensusMode is required', 400, 'invalid_body');
  }
  const raw = value.trim().toLowerCase() as ConsensusMode;
  if (!VALID_MODES.has(raw)) {
    throw new ApiError(
      'consensusMode must be expected, rounded, outcome, scoreline, or draw',
      400,
      'invalid_body',
    );
  }
  return raw;
}
