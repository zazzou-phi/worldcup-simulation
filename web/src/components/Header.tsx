import type { TournamentState, KnockoutRoundAvailability } from '../types.js';
import { phaseLabel } from '@shared/engine/phase.js';
import type { AppView } from '../lib/appView.js';
import { DEFAULT_UPSET_VARIANCE } from '../lib/upsetVariance.js';
import type { ConsensusMode } from '../lib/consensusMode.js';
import { formatConsensusMode } from '../lib/consensusMode.js';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';
import { SimulateMenu } from './SimulateMenu.js';
import { PredictionKnockoutSimulateMenu } from './PredictionKnockoutSimulateMenu.js';
import { HeaderDropdownMenu } from './HeaderDropdownMenu.js';
import { UpsetFactorControl } from './UpsetFactorControl.js';
import { ConsensusModeControl } from './ConsensusModeControl.js';
import { RatingEloWeightControl, DEFAULT_RATING_ELO_WEIGHT } from './RatingEloWeightControl.js';
import { TournamentFormControl, DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT } from './TournamentFormControl.js';
import { ViewSwitcher } from './ViewSwitcher.js';
import { ViewHelpButton } from './ViewHelpButton.js';

interface Props {
  state: TournamentState;
  appView: AppView;
  showGroupView: boolean;
  publicMode?: boolean;
  consensusMode?: ConsensusMode;
  consensusModeDirty?: boolean;
  savingConsensusMode?: boolean;
  activePredictionLabel?: string | null;
  simulating: boolean;
  upsetVariance: number;
  ratingEloWeight: number;
  tournamentEloDeltaWeight: number;
  onAppViewChange: (view: AppView) => void;
  onUpsetVarianceChange: (value: number) => void;
  onRatingEloWeightChange: (value: number) => void;
  onTournamentEloDeltaWeightChange: (value: number) => void;
  onConsensusModeChange: (mode: ConsensusMode) => void;
  onSaveConsensusMode: () => void;
  onToggleStageView: () => void;
  onOpenSimulations: () => void;
  onOpenRatings: () => void;
  onSimulateGroupGames: (games: 1 | 2 | 3) => void;
  onSimulateKnockoutsThrough: (throughRound: string) => void;
  onOpenMonteCarlo: () => void;
  onOpenMasterTeamStats: () => void;
  onOpenTournamentStats: () => void;
  onOpenPredictions: () => void;
  onExportPublic?: () => void;
  exportingPublic?: boolean;
  onClearSimulation?: () => void;
  sampleActive?: boolean;
  hasSavedSample?: boolean;
  canSample?: boolean;
  canResampleKnockoutRound?: boolean;
  sampling?: boolean;
  simulatingPredictionKnockout?: boolean;
  onSample?: () => void;
  predictionKnockoutRounds?: KnockoutRoundAvailability[];
  predictionGroupStageComplete?: boolean;
  predictionHasKnockoutResults?: boolean;
  onSimulatePredictionKnockoutRound?: (roundName: string) => void;
  onOpenPredictionKnockoutBulk?: () => void;
  onClearPredictionKnockout?: () => void;
}

export function Header({
  state,
  appView,
  showGroupView,
  publicMode = false,
  consensusMode,
  consensusModeDirty = false,
  savingConsensusMode = false,
  activePredictionLabel,
  simulating,
  upsetVariance,
  ratingEloWeight,
  tournamentEloDeltaWeight,
  onAppViewChange,
  onUpsetVarianceChange,
  onRatingEloWeightChange,
  onTournamentEloDeltaWeightChange,
  onConsensusModeChange,
  onSaveConsensusMode,
  onToggleStageView,
  onOpenSimulations,
  onOpenRatings,
  onSimulateGroupGames,
  onSimulateKnockoutsThrough,
  onOpenMonteCarlo,
  onOpenMasterTeamStats,
  onOpenTournamentStats,
  onOpenPredictions,
  onExportPublic,
  exportingPublic = false,
  onClearSimulation,
  sampleActive = false,
  hasSavedSample = false,
  canSample = false,
  canResampleKnockoutRound = false,
  sampling = false,
  simulatingPredictionKnockout = false,
  onSample,
  predictionKnockoutRounds,
  predictionGroupStageComplete = false,
  predictionHasKnockoutResults = false,
  onSimulatePredictionKnockoutRound,
  onOpenPredictionKnockoutBulk,
  onClearPredictionKnockout,
}: Props) {
  const { simulation } = state;
  const narrow = useMediaQuery(MOBILE_QUERY);
  const isSimulationsView = appView === 'simulations';
  const isPredictionsView = appView === 'predictions';
  const isResultsView = appView === 'results';

  const meta = isPredictionsView ? (
    publicMode ? null : (
      <span className="header-meta header-predictions">
        {activePredictionLabel ? `${activePredictionLabel} · ` : ''}
        Consensus, {formatConsensusMode(consensusMode ?? 'floor')}
        {consensusModeDirty ? ' · unsaved' : ''}
      </span>
    )
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

  const showStageSetting = isSimulationsView || isPredictionsView || isResultsView;
  const showUpsetSetting = isSimulationsView || (isPredictionsView && !publicMode);
  const showRatings = isSimulationsView;
  const showManagePredictions = isPredictionsView && !publicMode;
  const showManageSimulations = isSimulationsView && !publicMode;

  const hasTopSection = showUpsetSetting || showRatings || isPredictionsView;
  const hasBottomSection =
    showStageSetting ||
    showManagePredictions ||
    showManageSimulations;

  const showPredictionKnockoutUpset =
    isPredictionsView && !publicMode && !showGroupView;
  const predictionsKnockoutView = isPredictionsView && !showGroupView;

  const showPredictionKnockoutRatingSettings = showPredictionKnockoutUpset;

  const menuActive =
    (showUpsetSetting && upsetVariance !== DEFAULT_UPSET_VARIANCE) ||
    (showPredictionKnockoutRatingSettings && ratingEloWeight !== DEFAULT_RATING_ELO_WEIGHT) ||
    (showPredictionKnockoutRatingSettings &&
      tournamentEloDeltaWeight !== DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT) ||
    (isSimulationsView && ratingEloWeight !== DEFAULT_RATING_ELO_WEIGHT) ||
    (isSimulationsView && tournamentEloDeltaWeight !== DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT) ||
    (isPredictionsView && consensusModeDirty);

  const hasMenu = hasTopSection || hasBottomSection;

  const optionsMenu = hasMenu ? (
    <HeaderDropdownMenu
      buttonLabel="⋮"
      buttonClassName="btn btn-ghost header-icon-btn header-options-btn"
      menuClassName="header-options-panel"
      ariaLabel="Options"
      active={menuActive}
    >
      {showUpsetSetting && (
        <>
          {isSimulationsView && (
            <>
              <RatingEloWeightControl
                value={ratingEloWeight}
                disabled={simulating}
                onChange={onRatingEloWeightChange}
              />
              <TournamentFormControl
                value={tournamentEloDeltaWeight}
                disabled={simulating}
                onChange={onTournamentEloDeltaWeightChange}
              />
            </>
          )}
          {(isSimulationsView || showPredictionKnockoutUpset) && (
            <UpsetFactorControl
              value={upsetVariance}
              disabled={simulating || simulatingPredictionKnockout}
              variant="compact"
              id={showPredictionKnockoutUpset ? 'header-prediction-upset-factor' : 'header-upset-factor'}
              onChange={onUpsetVarianceChange}
            />
          )}
          {showPredictionKnockoutRatingSettings && (
            <>
              <RatingEloWeightControl
                value={ratingEloWeight}
                disabled={simulatingPredictionKnockout}
                onChange={onRatingEloWeightChange}
              />
              <TournamentFormControl
                value={tournamentEloDeltaWeight}
                disabled={simulatingPredictionKnockout}
                onChange={onTournamentEloDeltaWeightChange}
              />
            </>
          )}
        </>
      )}
      {showRatings && (
        <>
          <button type="button" className="btn btn-ghost" onClick={onOpenRatings}>
            Country Ratings
          </button>
          <button type="button" className="btn btn-ghost" onClick={onOpenTournamentStats}>
            Tournament Stats
          </button>
        </>
      )}
      {isPredictionsView && !publicMode && consensusMode != null && (
        <ConsensusModeControl
          value={consensusMode}
          saving={savingConsensusMode}
          onChange={onConsensusModeChange}
        />
      )}
      {isPredictionsView && !publicMode && (onSample != null || consensusMode != null) && (
        <div className="header-sample-save-stack">
          {onSample != null && (
            <button
              type="button"
              className={`btn btn-ghost ${!predictionsKnockoutView && sampleActive ? 'active' : ''}`}
              disabled={
                predictionsKnockoutView
                  ? simulatingPredictionKnockout || !canResampleKnockoutRound
                  : sampling || (!hasSavedSample && !canSample)
              }
              title={
                predictionsKnockoutView
                  ? canResampleKnockoutRound
                    ? 'Re-run Monte Carlo for the latest simulated knockout round only'
                    : 'Simulate a knockout round first'
                  : sampleActive
                    ? hasSavedSample
                      ? 'Sample new pool scores for unlocked group fixtures'
                      : 'Sample pool scores for unlocked group fixtures'
                    : hasSavedSample
                      ? 'Use saved pool sample scores in group standings'
                      : 'Switch to sample view and sample pool scores'
              }
              onClick={onSample}
            >
              {predictionsKnockoutView
                ? simulatingPredictionKnockout
                  ? 'Resampling…'
                  : 'Resample round'
                : sampling
                  ? 'Sampling…'
                  : sampleActive && hasSavedSample
                    ? 'Resample'
                    : 'Sample'}
            </button>
          )}
          {consensusMode != null && (
            <button
              type="button"
              className={`btn btn-ghost header-consensus-save ${
                consensusModeDirty ? 'consensus-mode-save-dirty' : ''
              }`}
              disabled={!consensusModeDirty || savingConsensusMode}
              onClick={onSaveConsensusMode}
            >
              {savingConsensusMode ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
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
          {showManagePredictions && onExportPublic != null && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={exportingPublic}
              title="Write public-site JSON snapshots to web/public/data (same as npm run export:public)"
              onClick={onExportPublic}
            >
              {exportingPublic ? 'Exporting…' : 'Export Public Site'}
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
      {showManageSimulations && (
        <button type="button" className="btn btn-ghost" onClick={onOpenSimulations}>
          Manage Simulations
        </button>
      )}
    </HeaderDropdownMenu>
  ) : null;

  const showPredictionKnockoutSimulate =
    isPredictionsView && !showGroupView && !publicMode && predictionKnockoutRounds != null;

  const simulateMenu = isSimulationsView ? (
    <SimulateMenu
      state={state}
      simulating={simulating}
      publicMode={publicMode}
      simulationComplete={simulation.phase === 'complete'}
      onSimulateGroup={onSimulateGroupGames}
      onSimulateKnockouts={onSimulateKnockoutsThrough}
      onBulk={onOpenMonteCarlo}
      onClear={onClearSimulation}
    />
  ) : showPredictionKnockoutSimulate ? (
    <PredictionKnockoutSimulateMenu
      rounds={predictionKnockoutRounds}
      groupStageComplete={predictionGroupStageComplete}
      simulating={simulatingPredictionKnockout}
      hasKnockoutResults={predictionHasKnockoutResults}
      onSimulateRound={onSimulatePredictionKnockoutRound!}
      onOpenBulk={onOpenPredictionKnockoutBulk}
      onClearKnockout={onClearPredictionKnockout}
    />
  ) : null;

  const actions = (
    <>
      {simulateMenu}
      {optionsMenu}
      <ViewHelpButton appView={appView} publicMode={publicMode} />
    </>
  );

  if (narrow) {
    return (
      <header className="header header-mobile">
        <div className="header-row">
          <div className="header-left">
            <ViewSwitcher
              appView={appView}
              publicMode={publicMode}
              onAppViewChange={onAppViewChange}
            />
            <h1 className="header-title">WC 2026</h1>
          </div>
          <div className="header-actions">{actions}</div>
        </div>
        {meta != null && <div className="header-meta-row">{meta}</div>}
      </header>
    );
  }

  return (
    <header className="header">
      <div className="header-left">
        <ViewSwitcher
          appView={appView}
          publicMode={publicMode}
          onAppViewChange={onAppViewChange}
        />
        <h1 className="header-title">WC 2026 Simulator</h1>
        {meta}
      </div>
      <div className="header-actions">{actions}</div>
    </header>
  );
}
