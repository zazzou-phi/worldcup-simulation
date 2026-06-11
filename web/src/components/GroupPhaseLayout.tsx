import { useState, type ReactNode } from 'react';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';

type Tab = 'standings' | 'fixtures';

interface Props {
  layout: 'horizontal' | 'vertical';
  standings: ReactNode;
  fixtures: ReactNode;
}

export function GroupPhaseLayout({ layout, standings, fixtures }: Props) {
  const narrow = useMediaQuery(MOBILE_QUERY);
  const [tab, setTab] = useState<Tab>('standings');

  const classes = [
    'group-phase',
    `layout-${layout}`,
    narrow ? 'group-phase-mobile' : '',
    narrow && tab === 'fixtures' ? 'group-phase-show-fixtures' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      {narrow && (
        <div className="group-phase-tab-bar" role="tablist" aria-label="Group phase">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'standings'}
            className={`group-phase-tab${tab === 'standings' ? ' active' : ''}`}
            onClick={() => setTab('standings')}
          >
            Standings
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'fixtures'}
            className={`group-phase-tab${tab === 'fixtures' ? ' active' : ''}`}
            onClick={() => setTab('fixtures')}
          >
            Fixtures
          </button>
        </div>
      )}
      <div className="group-phase-standings">{standings}</div>
      <div className="group-phase-fixtures">{fixtures}</div>
    </div>
  );
}
