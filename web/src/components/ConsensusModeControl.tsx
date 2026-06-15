import type { ConsensusMode } from '../lib/consensusMode.js';
import {
  CONSENSUS_MODE_HINT,
  CONSENSUS_MODE_PICKER_OPTIONS,
} from '../lib/consensusMode.js';

interface Props {
  value: ConsensusMode;
  dirty: boolean;
  saving?: boolean;
  canSave: boolean;
  onChange: (value: ConsensusMode) => void;
  onSave: () => void;
}

export function ConsensusModeControl({
  value,
  dirty,
  saving = false,
  canSave,
  onChange,
  onSave,
}: Props) {
  return (
    <div className="header-settings-segment consensus-mode-control" title={CONSENSUS_MODE_HINT}>
      <span className="header-settings-segment-label">Consensus</span>
      <div className="header-settings-segment-buttons">
        {CONSENSUS_MODE_PICKER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`btn btn-ghost ${value === option.value ? 'active' : ''}`}
            title={CONSENSUS_MODE_HINT}
            disabled={saving}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {canSave && (
        <button
          type="button"
          className={`btn btn-ghost consensus-mode-save ${dirty ? 'consensus-mode-save-dirty' : ''}`}
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving ? 'Saving…' : dirty ? 'Save mode' : 'Saved'}
        </button>
      )}
    </div>
  );
}
