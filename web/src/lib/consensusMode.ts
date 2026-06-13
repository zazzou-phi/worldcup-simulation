import type { ConsensusMode } from '@shared/engine/consensus.js';
import { DEFAULT_CONSENSUS_MODE } from '@shared/engine/consensus.js';

export { DEFAULT_CONSENSUS_MODE };
export type { ConsensusMode };

export const CONSENSUS_MODE_OPTIONS: { value: ConsensusMode; label: string }[] = [
  { value: 'expected', label: 'Expected' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'outcome', label: 'Outcome' },
  { value: 'scoreline', label: 'Scoreline' },
];

export const CONSENSUS_MODE_HINT =
  'How consensus picks a score from simulation distributions. Expected uses floored mean goals with modal scores for wins; Rounded uses the rounded mean only; Outcome picks the modal result then score; Scoreline picks the most frequent score within each outcome.';

export function formatConsensusMode(mode: ConsensusMode): string {
  return CONSENSUS_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

const STORAGE_KEY = 'wc-consensus-mode';

export function loadStoredConsensusMode(predictionId: number): ConsensusMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${predictionId}`);
    if (raw === 'expected' || raw === 'outcome' || raw === 'scoreline' || raw === 'rounded') {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function storeConsensusMode(predictionId: number, mode: ConsensusMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${STORAGE_KEY}:${predictionId}`, mode);
  } catch {
    /* ignore */
  }
}
