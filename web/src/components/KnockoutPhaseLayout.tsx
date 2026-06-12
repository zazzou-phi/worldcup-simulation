import type { ReactNode } from 'react';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';

interface Props {
  useBracketView: boolean;
  onViewChange: (useBracket: boolean) => void;
  bracket: ReactNode;
  fixtures: ReactNode;
}

export function KnockoutPhaseLayout({
  useBracketView,
  onViewChange,
  bracket,
  fixtures,
}: Props) {
  const narrow = useMediaQuery(MOBILE_QUERY);

  const bracketContent = useBracketView ? bracket : fixtures;

  if (!narrow) {
    return <div className="knockout-view">{bracketContent}</div>;
  }

  const classes = [
    'knockout-view',
    'knockout-phase-mobile',
    !useBracketView ? 'knockout-phase-show-fixtures' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <div className="group-phase-tab-bar" role="tablist" aria-label="Knockout phase">
        <button
          type="button"
          role="tab"
          aria-selected={useBracketView}
          className={`group-phase-tab${useBracketView ? ' active' : ''}`}
          onClick={() => onViewChange(true)}
        >
          Bracket
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!useBracketView}
          className={`group-phase-tab${!useBracketView ? ' active' : ''}`}
          onClick={() => onViewChange(false)}
        >
          Fixtures
        </button>
      </div>
      <div className="knockout-phase-bracket">{bracket}</div>
      <div className="knockout-phase-fixtures">{fixtures}</div>
    </div>
  );
}
