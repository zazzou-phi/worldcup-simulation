import type { TournamentState } from '../types.js';
import { isGroupStagePhase, isKnockoutStagePhase, phaseLabel } from '@shared/engine/phase.js';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';
import { GroupSimulateMenu, KnockoutSimulateMenu } from './SimulateMenu.js';
import { HeaderMoreMenu } from './HeaderMoreMenu.js';

interface Props {
  state: TournamentState;
  layout: 'horizontal' | 'vertical';
  showGroupView: boolean;
  actualResultsMode: boolean;
  masterMode: boolean;
  publicMode?: boolean;
  masterConsensusMode?: 'scoreline' | 'outcome' | 'expected';
  simulating: boolean;
  onLayoutChange: (layout: 'horizontal' | 'vertical') => void;
  onToggleStageView: () => void;
  onToggleActualResults: () => void;
  onToggleMaster: () => void;
  onOpenSimulations: () => void;
  onOpenRatings: () => void;
  onSimulateGroupGames: (games: 1 | 2 | 3) => void;
  onSimulateKnockoutsThrough: (throughRound: string) => void;
  onOpenMonteCarlo: () => void;
  onOpenMasterTeamStats: () => void;
}

export function Header({
  state,
  layout,
  showGroupView,
  actualResultsMode,
  masterMode,
  publicMode = false,
  masterConsensusMode,
  simulating,
  onLayoutChange,
  onToggleStageView,
  onToggleActualResults,
  onToggleMaster,
  onOpenSimulations,
  onOpenRatings,
  onSimulateGroupGames,
  onSimulateKnockoutsThrough,
  onOpenMonteCarlo,
  onOpenMasterTeamStats,
}: Props) {
  const { simulation } = state;
  const narrow = useMediaQuery(MOBILE_QUERY);

  const meta = masterMode ? (
    <span className="header-meta header-master">
      Master (consensus, {masterConsensusMode ?? 'expected'})
    </span>
  ) : actualResultsMode ? (
    <span className="header-meta header-actual">Actual Results</span>
  ) : (
    <>
      <span className="header-meta">{simulation.name}</span>
      <span className="header-meta">phase: {phaseLabel(simulation.phase)}</span>
      {simulation.phase === 'complete' && (
        <span className="header-champion">CHAMPION DECIDED</span>
      )}
    </>
  );

  const stageToggle =
    !actualResultsMode && !masterMode ? (
      <button type="button" className="btn btn-ghost" onClick={onToggleStageView}>
        {showGroupView ? 'Knockout Stage' : 'Group Stage'}
      </button>
    ) : null;

  const layoutToggle =
    (masterMode ||
      (!actualResultsMode && isGroupStagePhase(simulation.phase) && showGroupView)) && (
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => onLayoutChange(layout === 'horizontal' ? 'vertical' : 'horizontal')}
      >
        Layout: {layout}
      </button>
    );

  const actualResultsToggle = (
    <button
      type="button"
      className={`btn btn-ghost ${actualResultsMode ? 'active' : ''}`}
      onClick={onToggleActualResults}
      disabled={masterMode}
    >
      {actualResultsMode ? 'Simulations' : 'Actual Results'}
    </button>
  );

  const masterTeamStats =
    masterMode ? (
      <button type="button" className="btn btn-ghost" onClick={onOpenMasterTeamStats}>
        Team Stats
      </button>
    ) : null;

  const simulateMenus =
    !actualResultsMode && !masterMode ? (
      <>
        {isGroupStagePhase(simulation.phase) && (
          <GroupSimulateMenu simulating={simulating} onSelect={onSimulateGroupGames} />
        )}
        {isKnockoutStagePhase(simulation.phase) && simulation.phase !== 'complete' && (
          <KnockoutSimulateMenu simulating={simulating} onSelect={onSimulateKnockoutsThrough} />
        )}
      </>
    ) : null;

  const adminActions =
    !actualResultsMode && !masterMode && !publicMode ? (
      <>
        <button type="button" className="btn btn-ghost" onClick={onOpenSimulations}>
          Simulations
        </button>
        <button type="button" className="btn btn-ghost" onClick={onOpenRatings}>
          Ratings
        </button>
        <button type="button" className="btn btn-ghost" onClick={onOpenMonteCarlo}>
          Bulk Simulate
        </button>
        <span className="header-id">#{simulation.id}</span>
      </>
    ) : null;

  if (narrow) {
    return (
      <header className="header header-mobile">
        <div className="header-row">
          <div className="header-left">
            <button
              type="button"
              className={`btn btn-ghost header-master-btn ${masterMode ? 'active' : ''}`}
              onClick={onToggleMaster}
              disabled={actualResultsMode}
            >
              {masterMode ? 'Simulations' : 'Master'}
            </button>
            <h1 className="header-title">WC 2026</h1>
          </div>
          <div className="header-actions">
            {stageToggle}
            <HeaderMoreMenu>
              {actualResultsToggle}
              {masterTeamStats}
              {simulateMenus}
              {adminActions}
            </HeaderMoreMenu>
          </div>
        </div>
        <div className="header-meta-row">{meta}</div>
      </header>
    );
  }

  return (
    <header className="header">
      <div className="header-left">
        <button
          type="button"
          className={`btn btn-ghost header-master-btn ${masterMode ? 'active' : ''}`}
          onClick={onToggleMaster}
          disabled={actualResultsMode}
        >
          {masterMode ? 'Simulations' : 'Master'}
        </button>
        <h1 className="header-title">WC 2026 Simulator</h1>
        {meta}
      </div>
      <div className="header-actions">
        {layoutToggle}
        {stageToggle}
        {actualResultsToggle}
        {masterTeamStats}
        {simulateMenus}
        {adminActions}
      </div>
    </header>
  );
}
