import {
  DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT,
  formatTournamentEloDeltaWeight,
  TOURNAMENT_ELO_DELTA_WEIGHT_MAX,
  TOURNAMENT_FORM_HINT,
} from '../lib/tournamentEloDeltaWeight.js';

interface Props {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  variant?: 'compact' | 'full';
  id?: string;
}

export function TournamentFormControl({
  value,
  disabled = false,
  onChange,
  variant = 'compact',
  id = 'tournament-form',
}: Props) {
  const displayValue = formatTournamentEloDeltaWeight(value);

  if (variant === 'compact') {
    return (
      <div className="upset-factor upset-factor-compact" title={TOURNAMENT_FORM_HINT}>
        <label className="upset-factor-label" htmlFor={id} title={TOURNAMENT_FORM_HINT}>
          Tournament form <span className="upset-factor-value">{displayValue}</span>
        </label>
        <input
          id={id}
          className="upset-factor-range"
          type="range"
          min={0}
          max={TOURNAMENT_ELO_DELTA_WEIGHT_MAX}
          step={0.25}
          value={value}
          disabled={disabled}
          title={TOURNAMENT_FORM_HINT}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
    );
  }

  return (
    <div className="upset-factor upset-factor-full">
      <label className="modal-label" htmlFor={id} title={TOURNAMENT_FORM_HINT}>
        Tournament form <span className="muted upset-factor-value">{displayValue}</span>
      </label>
      <input
        id={id}
        className="modal-range"
        type="range"
        min={0}
        max={TOURNAMENT_ELO_DELTA_WEIGHT_MAX}
        step={0.25}
        value={value}
        disabled={disabled}
        title={TOURNAMENT_FORM_HINT}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <p className="muted upset-factor-hint">{TOURNAMENT_FORM_HINT}</p>
    </div>
  );
}

export { DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT };
