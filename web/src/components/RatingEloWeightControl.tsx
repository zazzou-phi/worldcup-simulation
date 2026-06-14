import {
  DEFAULT_RATING_ELO_WEIGHT,
  formatRatingEloWeight,
  RATING_ELO_WEIGHT_HINT,
} from '../lib/ratingEloWeight.js';

interface Props {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  variant?: 'compact' | 'full';
  id?: string;
}

export function RatingEloWeightControl({
  value,
  disabled = false,
  onChange,
  variant = 'compact',
  id = 'rating-elo-weight',
}: Props) {
  const displayValue = formatRatingEloWeight(value);

  if (variant === 'compact') {
    return (
      <div className="upset-factor upset-factor-compact" title={RATING_ELO_WEIGHT_HINT}>
        <label className="upset-factor-label" htmlFor={id} title={RATING_ELO_WEIGHT_HINT}>
          Country Ratings <span className="upset-factor-value">{displayValue}</span>
        </label>
        <input
          id={id}
          className="upset-factor-range"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          disabled={disabled}
          title={RATING_ELO_WEIGHT_HINT}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
    );
  }

  return (
    <div className="upset-factor upset-factor-full">
      <label className="modal-label" htmlFor={id} title={RATING_ELO_WEIGHT_HINT}>
        Country Ratings blend <span className="muted upset-factor-value">{displayValue}</span>
      </label>
      <input
        id={id}
        className="modal-range"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        disabled={disabled}
        title={RATING_ELO_WEIGHT_HINT}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <p className="muted upset-factor-hint">{RATING_ELO_WEIGHT_HINT}</p>
    </div>
  );
}

export { DEFAULT_RATING_ELO_WEIGHT };
