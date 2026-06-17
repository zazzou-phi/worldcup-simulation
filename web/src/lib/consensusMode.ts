import type { ConsensusMode } from '@shared/engine/consensus.js';
import { DEFAULT_CONSENSUS_MODE, parseConsensusMode } from '@shared/engine/consensus.js';

export { DEFAULT_CONSENSUS_MODE };
export type { ConsensusMode };

export const CONSENSUS_MODE_OPTIONS: { value: ConsensusMode; label: string }[] = [
  { value: 'floor', label: 'Floor' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'outcome', label: 'Outcome' },
  { value: 'scoreline', label: 'Scoreline' },
  { value: 'sample', label: 'Sample' },
];

/** Consensus picker in the header — Sample is a separate button. */
export const CONSENSUS_MODE_PICKER_OPTIONS = CONSENSUS_MODE_OPTIONS.filter(
  (option) => option.value !== 'sample',
);

export const CONSENSUS_MODE_HINT =
  'How consensus picks a score from simulation distributions. Floor uses floored mean goals with modal scores for wins; Rounded uses the rounded mean only; Outcome picks the modal result then score; Scoreline picks the most frequent score within each outcome. Use the Sample button for saved pool samples.';

export function formatConsensusMode(mode: ConsensusMode): string {
  return CONSENSUS_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

const STORAGE_KEY = 'wc-consensus-mode';

export function loadStoredConsensusMode(predictionId: number): ConsensusMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${predictionId}`);
    if (!raw) return null;
    const mode = parseConsensusMode(raw);
    if (mode === 'floor' || mode === 'outcome' || mode === 'scoreline' || mode === 'rounded' || mode === 'sample') {
      return mode;
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
