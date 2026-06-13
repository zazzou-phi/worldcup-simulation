import type { TournamentState } from '../types.js';
import { isGroupStagePhase, phaseLabel } from '@shared/engine/phase.js';
import type { AppView } from '../lib/appView.js';
import { DEFAULT_UPSET_VARIANCE } from '../lib/upsetVariance.js';
import type { ConsensusMode } from '../lib/consensusMode.js';
import { formatConsensusMode } from '../lib/consensusMode.js';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';
import { SimulateMenu } from './SimulateMenu.js';
import { HeaderDropdownMenu } from './HeaderDropdownMenu.js';
import { UpsetFactorControl } from './UpsetFactorControl.js';
import { ConsensusModeControl } from './ConsensusModeControl.js';
import { RatingEloWeightControl, DEFAULT_RATING_ELO_WEIGHT } from './RatingEloWeightControl.js';
import { ViewSwitcher } from './ViewSwitcher.js';

interface Props {
  state: TournamentState;
  appView: AppView;
  layout: 'horizontal' | 'vertical';
  showGroupView: boolean;
  knockoutBracketView: boolean;
  publicMode?: boolean;
  consensusMode?: ConsensusMode;
  consensusModeDirty?: boolean;
  savingConsensusMode?: boolean;
  activePredictionLabel?: string | null;
  simulating: boolean;
  upsetVariance: number;
  ratingEloWeight: number;
  onAppViewChange: (view: AppView) => void;
  onUpsetVarianceChange: (value: number) => void;
  onRatingEloWeightChange: (value: number) => void;
  onConsensusModeChange: (mode: ConsensusMode) => void;
  onSaveConsensusMode: () => void;
  onLayoutChange: (layout: 'horizontal' | 'vertical') => void;
  onKnockoutBracketViewChange: (useBracket: boolean) => void;
  onToggleStageView: () => void;
  onOpenSimulations: () => void;
  onOpenRatings: () => void;
  onSimulateGroupGames: (games: 1 | 2 | 3) => void;
  onSimulateKnockoutsThrough: (throughRound: string) => void;
  onOpenMonteCarlo: () => void;
  onOpenMasterTeamStats: () => void;
  onOpenTournamentStats: () => void;
  onOpenPredictions: () => void;
  onClearSimulation?: () => void;
}

export function Header({
  state,
  appView,
  layout,
  showGroupView,
  knockoutBracketView,
  publicMode = false,
  consensusMode,
  consensusModeDirty = false,
  savingConsensusMode = false,
  activePredictionLabel,
  simulating,
  upsetVariance,
  ratingEloWeight,
  onAppViewChange,
  onUpsetVarianceChange,
  onRatingEloWeightChange,
  onConsensusModeChange,
  onSaveConsensusMode,
  onLayoutChange,
  onKnockoutBracketViewChange,
  onToggleStageView,
  onOpenSimulations,
  onOpenRatings,
  onSimulateGroupGames,
  onSimulateKnockoutsThrough,
  onOpenMonteCarlo,
  onOpenMasterTeamStats,
  onOpenTournamentStats,
  onOpenPredictions,
  onClearSimulation,
}: Props) {
  const { simulation } = state;
  const narrow = useMediaQuery(MOBILE_QUERY);
  const isSimulationsView = appView === 'simulations';
  const isPredictionsView = appView === 'predictions';
  const isResultsView = appView === 'results';

  const meta = isPredictionsView ? (
    <span className="header-meta header-predictions">
      {activePredictionLabel ? `${activePredictionLabel} · ` : ''}
      Consensus, {formatConsensusMode(consensusMode ?? 'expected')}
      {consensusModeDirty ? ' · unsaved' : ''}
    </span>
  ) : isResultsView ? (
    <span className="header-meta header-results">Recorded match results</span>
  ) : (
    <>
      <span className="header-meta">phase: {phaseLabel(simulation.phase)}</span>
      {simulation.phase === 'complete' && (
        <span className="header-champion">CHAMPION DECIDED</span>
      )}
    </>
  );

  const showStageSetting = isSimulationsView;
  const showLayoutSetting =
    !narrow &&
    (isPredictionsView ||
      isResultsView ||
      (isSimulationsView && isGroupStagePhase(simulation.phase) && showGroupView));
  const showUpsetSetting = isSimulationsView;
  const showBracketSetting = isSimulationsView && !showGroupView && !narrow;
  const showRatings = isSimulationsView;
  const showManagePredictions = isPredictionsView && !publicMode;
  const showManageSimulations = isSimulationsView && !publicMode;
  const showClearSimulation = isSimulationsView && onClearSimulation != null;

  const hasTopSection = showUpsetSetting || showRatings || isPredictionsView;
  const hasBottomSection =
    showStageSetting ||
    showLayoutSetting ||
    showBracketSetting ||
    showManagePredictions ||
    showManageSimulations ||
    showClearSimulation;

  const menuActive =
    (showUpsetSetting && upsetVariance !== DEFAULT_UPSET_VARIANCE) ||
    (showUpsetSetting && ratingEloWeight !== DEFAULT_RATING_ELO_WEIGHT) ||
    (isPredictionsView && consensusModeDirty) ||
    (showLayoutSetting && layout !== 'vertical');

  const hasMenu = hasTopSection || hasBottomSection;

  const optionsMenu = hasMenu ? (
    <HeaderDropdownMenu
      buttonLabel="⋮"
      buttonClassName="btn btn-ghost header-icon-btn"
      menuClassName="header-options-panel"
      ariaLabel="Options"
      active={menuActive}
    >
      {showUpsetSetting && (
        <>
          <RatingEloWeightControl
            value={ratingEloWeight}
            disabled={simulating}
            onChange={onRatingEloWeightChange}
          />
          <UpsetFactorControl
            value={upsetVariance}
            disabled={simulating}
            variant="compact"
            id="header-upset-factor"
            onChange={onUpsetVarianceChange}
          />
        </>
      )}
      {showRatings && (
        <>
          <button type="button" className="btn btn-ghost" onClick={onOpenRatings}>
            Ratings
          </button>
          <button type="button" className="btn btn-ghost" onClick={onOpenTournamentStats}>
            Tournament Stats
          </button>
        </>
      )}
      {isPredictionsView && consensusMode != null && (
        <ConsensusModeControl
          value={consensusMode}
          dirty={consensusModeDirty}
          saving={savingConsensusMode}
          canSave={!publicMode}
          onChange={onConsensusModeChange}
          onSave={onSaveConsensusMode}
        />
      )}
      {isPredictionsView && (
        <>
          <button type="button" className="btn btn-ghost" onClick={onOpenTournamentStats}>
            Tournament Stats
          </button>
          <button type="button" className="btn btn-ghost" onClick={onOpenMasterTeamStats}>
            Team Stats
          </button>
          {showManagePredictions && (
            <button type="button" className="btn btn-ghost" onClick={onOpenPredictions}>
              Manage Predictions
            </button>
          )}
        </>
      )}
      {hasTopSection && hasBottomSection && (
        <div className="header-menu-divider" role="separator" />
      )}
      {showStageSetting && (
        <div className="header-settings-segment">
          <span className="header-settings-segment-label">Stage</span>
          <div className="header-settings-segment-buttons">
            <button
              type="button"
              className={`btn btn-ghost ${showGroupView ? 'active' : ''}`}
              onClick={() => {
                if (!showGroupView) onToggleStageView();
              }}
            >
              Group
            </button>
            <button
              type="button"
              className={`btn btn-ghost ${!showGroupView ? 'active' : ''}`}
              onClick={() => {
                if (showGroupView) onToggleStageView();
              }}
            >
              Knockout
            </button>
          </div>
        </div>
      )}
      {showLayoutSetting && (
        <div className="header-settings-segment">
          <span className="header-settings-segment-label">Layout</span>
          <div className="header-settings-segment-buttons">
            <button
              type="button"
              className={`btn btn-ghost ${layout === 'horizontal' ? 'active' : ''}`}
              onClick={() => onLayoutChange('horizontal')}
            >
              Horizontal
            </button>
            <button
              type="button"
              className={`btn btn-ghost ${layout === 'vertical' ? 'active' : ''}`}
              onClick={() => onLayoutChange('vertical')}
            >
              Vertical
            </button>
          </div>
        </div>
      )}
      {showBracketSetting && (
        <div className="header-settings-segment">
          <span className="header-settings-segment-label">Knockout display</span>
          <div className="header-settings-segment-buttons">
            <button
              type="button"
              className={`btn btn-ghost ${knockoutBracketView ? 'active' : ''}`}
              onClick={() => onKnockoutBracketViewChange(true)}
            >
              Bracket
            </button>
            <button
              type="button"
              className={`btn btn-ghost ${!knockoutBracketView ? 'active' : ''}`}
              onClick={() => onKnockoutBracketViewChange(false)}
            >
              Fixtures
            </button>
          </div>
        </div>
      )}
      {showManageSimulations && (
        <button type="button" className="btn btn-ghost" onClick={onOpenSimulations}>
          Manage Simulations
        </button>
      )}
      {showClearSimulation && (
        <>
          {(hasTopSection ||
            showStageSetting ||
            showLayoutSetting ||
            showBracketSetting ||
            showManageSimulations) && <div className="header-menu-divider" role="separator" />}
          <button type="button" className="btn btn-ghost btn-danger" onClick={onClearSimulation}>
            Clear simulation
          </button>
        </>
      )}
    </HeaderDropdownMenu>
  ) : null;

  const simulateMenu = isSimulationsView ? (
    <SimulateMenu
      state={state}
      simulating={simulating}
      publicMode={publicMode}
      simulationComplete={simulation.phase === 'complete'}
      onSimulateGroup={onSimulateGroupGames}
      onSimulateKnockouts={onSimulateKnockoutsThrough}
      onBulk={onOpenMonteCarlo}
    />
  ) : null;

  const actions = (
    <>
      {simulateMenu}
      {optionsMenu}
    </>
  );

  if (narrow) {
    return (
      <header className="header header-mobile">
        <div className="header-row">
          <div className="header-left">
            <ViewSwitcher appView={appView} onAppViewChange={onAppViewChange} />
            <h1 className="header-title">WC 2026</h1>
          </div>
          <div className="header-actions">{actions}</div>
        </div>
        <div className="header-meta-row">{meta}</div>
      </header>
    );
  }

  return (
    <header className="header">
      <div className="header-left">
        <ViewSwitcher appView={appView} onAppViewChange={onAppViewChange} />
        <h1 className="header-title">WC 2026 Simulator</h1>
        {meta}
      </div>
      <div className="header-actions">{actions}</div>
    </header>
  );
}
