import type { ConsensusMode } from '../engine/consensus.js';
import { parseConsensusMode } from '../engine/consensus.js';
import { ApiError } from './errors.js';

const VALID_MODES = new Set<ConsensusMode>(['floor', 'outcome', 'scoreline', 'rounded', 'sample']);

export function parseConsensusModeBody(value: unknown): ConsensusMode {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError('consensusMode is required', 400, 'invalid_body');
  }
  const mode = parseConsensusMode(value);
  if (!VALID_MODES.has(mode)) {
    throw new ApiError(
      'consensusMode must be floor, rounded, outcome, scoreline, or sample',
      400,
      'invalid_body',
    );
  }
  return mode;
}
