import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, isPublicMode, loadInitialPrediction, loadInitialSimulation } from './api/client.js';
import { loadPublicMeta } from './api/staticClient.js';
import { clearStoredPrediction, persistLocalPrediction } from './lib/localPredictionStorage.js';
import {
  clearLocalMatchScore,
  LocalSimulationError,
  setLocalMatchScore,
  simulateLocalGroupPhase,
  simulateLocalKnockouts,
  simulateLocalMatch,
} from './lib/localSimulation.js';
import type {
  ActualResultsState,
  MasterGroupState,
  PublicMeta,
  Team,
  TournamentState,
} from './types.js';
import { Header } from './components/Header.js';
import { ActualResultsView } from './components/ActualResultsView.js';
import { GroupPhaseView } from './components/GroupPhaseView.js';
import { KnockoutView } from './components/KnockoutView.js';
import { MasterGroupView } from './components/MasterGroupView.js';
import { MonteCarloModal } from './components/MonteCarloModal.js';
import type { AppView } from './lib/appView.js';
import { DEFAULT_UPSET_VARIANCE } from './lib/upsetVariance.js';
import { DEFAULT_RATING_ELO_WEIGHT, loadStoredRatingEloWeight, storeRatingEloWeight } from './lib/ratingEloWeight.js';
import {
  DEFAULT_CONSENSUS_MODE,
  loadStoredConsensusMode,
  type ConsensusMode,
} from './lib/consensusMode.js';
import { applyConsensusMode } from './lib/applyConsensusMode.js';
import { applyRatingEloWeightToStateTeams } from './lib/normalizeTeam.js';
import { applyBlendRatingsToTeams } from '@shared/engine/teamRatings.js';
import { MOBILE_QUERY } from './lib/useMediaQuery.js';
import { SimulationManagerModal } from './components/SimulationManagerModal.js';
import { PredictionManagerModal } from './components/PredictionManagerModal.js';
import { TeamRatingsModal } from './components/TeamRatingsModal.js';
import { MasterTeamStatsModal } from './components/MasterTeamStatsModal.js';
import { TournamentStatsModal } from './components/TournamentStatsModal.js';
import { DrawConfirmModal } from './components/DrawConfirmModal.js';
import type { MonteCarloResult } from './types.js';

export function App() {
  const publicMode = isPublicMode();
  const [simulationId, setSimulationId] = useState<number | null>(null);
  const [state, setState] = useState<TournamentState | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedMatchNumber, setSelectedMatchNumber] = useState<number | null>(null);
  const [editingMatchNumber, setEditingMatchNumber] = useState<number | null>(null);
  const [showSimulations, setShowSimulations] = useState(false);
  const [showPredictions, setShowPredictions] = useState(false);
  const [showRatings, setShowRatings] = useState(false);
  const [showMonteCarlo, setShowMonteCarlo] = useState(false);
  const [monteCarloResult, setMonteCarloResult] = useState<MonteCarloResult | null>(null);
  const [monteCarloError, setMonteCarloError] = useState<string | null>(null);
  const [monteCarloProgress, setMonteCarloProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [bulkSimulating, setBulkSimulating] = useState(false);
  const [viewKnockout, setViewKnockout] = useState(false);
  const [appView, setAppView] = useState<AppView>(publicMode ? 'simulations' : 'predictions');
  const [actualState, setActualState] = useState<ActualResultsState | null>(null);
  const [knockoutBracketView, setKnockoutBracketView] = useState(
    () => typeof window !== 'undefined' && !window.matchMedia(MOBILE_QUERY).matches,
  );
  const [masterStateBase, setMasterStateBase] = useState<MasterGroupState | null>(null);
  const [consensusModeDraft, setConsensusModeDraft] = useState<ConsensusMode>(DEFAULT_CONSENSUS_MODE);
  const [consensusModeSaved, setConsensusModeSaved] = useState<ConsensusMode>(DEFAULT_CONSENSUS_MODE);
  const [savingConsensusMode, setSavingConsensusMode] = useState(false);
  const [savingFrozenConsensus, setSavingFrozenConsensus] = useState(false);
  const [predictionId, setPredictionId] = useState<number | null>(null);
  const [activePredictionLabel, setActivePredictionLabel] = useState<string | null>(null);
  const [showMasterTeamStats, setShowMasterTeamStats] = useState(false);
  const [showTournamentStats, setShowTournamentStats] = useState(false);
  const [showDrawConfirm, setShowDrawConfirm] = useState(false);
  const [drawingPrediction, setDrawingPrediction] = useState(false);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [publicMeta, setPublicMeta] = useState<PublicMeta | null>(null);
  const [upsetVariance, setUpsetVariance] = useState(DEFAULT_UPSET_VARIANCE);
  const [ratingEloWeight, setRatingEloWeight] = useState(
    publicMode ? loadStoredRatingEloWeight() : DEFAULT_RATING_ELO_WEIGHT,
  );

  const refreshState = useCallback(
    async (id: number) => {
      const next = await api.getState(id);
      setState(next);
      return next;
    },
    [],
  );

  const refreshActualState = useCallback(async () => {
    const next = await api.getActualResultsState();
    setActualState(next);
    return next;
  }, []);

  const refreshMasterState = useCallback(async (id?: number | null) => {
    const pid = id ?? predictionId;
    if (pid == null) {
      setMasterStateBase(null);
      return null;
    }
    const next = await api.getMasterGroupState(pid);
    setMasterStateBase(next);
    const saved = next.consensusMode;
    setConsensusModeSaved(saved);
    const stored = !publicMode ? loadStoredConsensusMode(pid) : null;
    setConsensusModeDraft(stored ?? saved);
    return next;
  }, [predictionId, publicMode]);

  const masterState = useMemo(() => {
    if (!masterStateBase || !state) return masterStateBase;
    if (publicMode || consensusModeDraft === masterStateBase.consensusMode) return masterStateBase;
    return applyConsensusMode(
      masterStateBase,
      consensusModeDraft,
      state.fixtures,
      state.groupMemberships,
      state.actualResults ?? [],
    );
  }, [masterStateBase, consensusModeDraft, state, publicMode]);

  const canDrawPrediction = useMemo(() => {
    if (!masterState) return false;
    return masterState.resolvedMatches.some((match) => {
      if (match.fixture.group == null || match.isLocked) return false;
      const dist =
        masterState.distributions[String(match.fixture.matchNumber)] ??
        masterState.distributions[match.fixture.matchNumber as unknown as string];
      return (dist?.total ?? 0) > 0;
    });
  }, [masterState]);

  useEffect(() => {
    (async () => {
      try {
        const [simulationLoad, initialPrediction, meta, settings] = await Promise.all([
          loadInitialSimulation(),
          loadInitialPrediction(),
          publicMode ? loadPublicMeta() : Promise.resolve(null),
          publicMode ? Promise.resolve(null) : api.getRatingEloWeight(),
        ]);
        const { id, state: initialState } = simulationLoad;
        const weight = publicMode
          ? loadStoredRatingEloWeight()
          : (settings?.ratingEloWeight ?? DEFAULT_RATING_ELO_WEIGHT);
        setRatingEloWeight(weight);
        const blendedState = {
          ...initialState,
          teams: applyRatingEloWeightToStateTeams(initialState.teams, weight),
        };
        setSimulationId(id);
        setState(blendedState);
        setPredictionId(initialPrediction.id);
        setActivePredictionLabel(initialPrediction.label);
        if (initialPrediction.id != null) {
          const loaded = await api.getMasterGroupState(initialPrediction.id);
          setMasterStateBase(loaded);
          const saved = loaded.consensusMode;
          setConsensusModeSaved(saved);
          const stored = !publicMode
            ? loadStoredConsensusMode(initialPrediction.id)
            : null;
          setConsensusModeDraft(stored ?? saved);
        }
        if (publicMode && meta) {
          setPublicMeta(meta);
          setTeams(Object.values(blendedState.teams));
        } else if (!publicMode) {
          setTeams(await api.listTeams());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [publicMode]);

  useEffect(() => {
    if (!publicMode || !state || !publicMeta) return;
    persistLocalPrediction(state, publicMeta);
  }, [publicMode, state, publicMeta]);

  const showGroupView = !viewKnockout;

  const switchPrediction = async (id: number) => {
    const prediction = await api.activatePrediction(id);
    const page = await api.listPredictions(1, 100);
    const entry = page.items.find((item) => item.id === id);
    setPredictionId(id);
    setActivePredictionLabel(
      entry ? `${entry.name} (${entry.selectionLabel})` : prediction.name,
    );
    await refreshMasterState(id);
    setShowPredictions(false);
  };

  const handleCreatePrediction = async (name: string, selection: string) => {
    const prediction = await api.createPrediction(name, selection);
    await switchPrediction(prediction.id);
  };

  const handleRenamePrediction = async (id: number, name: string) => {
    await api.renamePrediction(id, name);
    if (id === predictionId) {
      const page = await api.listPredictions(1, 100);
      const entry = page.items.find((item) => item.id === id);
      if (entry) setActivePredictionLabel(`${entry.name} (${entry.selectionLabel})`);
    }
  };

  const handleDeletePrediction = async (id: number) => {
    await api.deletePrediction(id);
    if (id === predictionId) {
      const page = await api.listPredictions(1, 1);
      if (page.total === 0) {
        setPredictionId(null);
        setActivePredictionLabel(null);
        setMasterStateBase(null);
      } else {
        await switchPrediction(page.items[0].id);
      }
    }
  };

  const switchSimulation = async (id: number) => {
    await api.activateSimulation(id);
    setSimulationId(id);
    await refreshState(id);
    setShowSimulations(false);
    setSelectedMatchNumber(null);
    setEditingMatchNumber(null);
  };

  const handleSaveScore = async (
    matchNumber: number,
    goalsHome: number,
    goalsAway: number,
    winnerTeamId: number | null,
  ) => {
    if (simulationId == null || !state) return;
    try {
      if (publicMode) {
        setState(setLocalMatchScore(state, matchNumber, goalsHome, goalsAway, winnerTeamId));
      } else {
        await api.setMatchScore(simulationId, matchNumber, goalsHome, goalsAway, winnerTeamId);
        await refreshState(simulationId);
        if (appView === 'predictions') await refreshMasterState();
      }
      setEditingMatchNumber(null);
    } catch (err) {
      setError(
        err instanceof LocalSimulationError || err instanceof Error
          ? err.message
          : 'Failed to save score',
      );
    }
  };

  const handleClearScore = async (matchNumber: number) => {
    if (simulationId == null || !state) return;
    try {
      if (publicMode) {
        setState(clearLocalMatchScore(state, matchNumber));
      } else {
        await api.clearMatchScore(simulationId, matchNumber);
        await refreshState(simulationId);
        if (appView === 'predictions') await refreshMasterState();
      }
      setEditingMatchNumber(null);
    } catch (err) {
      setError(
        err instanceof LocalSimulationError || err instanceof Error
          ? err.message
          : 'Failed to clear score',
      );
    }
  };

  const handleSaveActualScore = async (
    matchNumber: number,
    goalsHome: number,
    goalsAway: number,
    winnerTeamId: number | null,
  ) => {
    try {
      await api.setActualResult(matchNumber, goalsHome, goalsAway, winnerTeamId);
      await refreshActualState();
      if (simulationId != null) await refreshState(simulationId);
      if (predictionId != null) await refreshMasterState();
      setEditingMatchNumber(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save actual result');
    }
  };

  const handleClearActualScore = async (matchNumber: number) => {
    try {
      await api.clearActualResult(matchNumber);
      await refreshActualState();
      if (simulationId != null) await refreshState(simulationId);
      if (predictionId != null) await refreshMasterState();
      setEditingMatchNumber(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear actual result');
    }
  };

  const switchAppView = async (view: AppView) => {
    if (view === appView || (publicMode && view === 'results')) return;
    setSelectedMatchNumber(null);
    setEditingMatchNumber(null);
    try {
      if (view === 'predictions') {
        await refreshMasterState();
      } else if (view === 'results') {
        await refreshActualState();
      }
      setAppView(view);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch view');
    }
  };

  const handleClearSimulation = async () => {
    try {
      clearStoredPrediction();
      const { state: fresh } = await loadInitialSimulation();
      setState(fresh);
      setSelectedMatchNumber(null);
      setEditingMatchNumber(null);
      setToast('Simulation cleared');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear simulation');
    }
  };

  const handleCreateSimulation = async (name: string) => {
    const sim = await api.createSimulation(name);
    await switchSimulation(sim.id);
  };

  const handleRenameSimulation = async (id: number, name: string) => {
    await api.renameSimulation(id, name);
    if (id === simulationId) await refreshState(id);
  };

  const handleDeleteSimulation = async (id: number) => {
    await api.deleteSimulation(id);
    if (id === simulationId) {
      const page = await api.listSimulations(1, 1);
      if (page.total === 0) {
        const sim = await api.createSimulation('Simulation');
        await switchSimulation(sim.id);
      } else {
        await switchSimulation(page.items[0].id);
      }
    }
  };

  const handleRatingEloWeightChange = async (value: number) => {
    setRatingEloWeight(value);
    if (publicMode) {
      storeRatingEloWeight(value);
      const sourceTeams = teams.length > 0 ? teams : Object.values(state?.teams ?? {});
      const nextTeams = applyBlendRatingsToTeams(sourceTeams, value);
      setTeams(nextTeams);
      if (state) {
        setState({
          ...state,
          teams: applyRatingEloWeightToStateTeams(state.teams, value),
        });
      }
      return;
    }
    await api.setRatingEloWeight(value);
    setTeams(await api.listTeams());
    if (simulationId != null) await refreshState(simulationId);
  };

  const handleConsensusModeChange = (mode: ConsensusMode) => {
    if (publicMode) return;
    setConsensusModeDraft(mode);
  };

  const handleSaveConsensusMode = async () => {
    if (predictionId == null || publicMode) return;
    setSavingConsensusMode(true);
    setError(null);
    try {
      await api.updatePredictionConsensusMode(predictionId, consensusModeDraft);
      await refreshMasterState(predictionId);
      setToast('Consensus mode saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save consensus mode');
    } finally {
      setSavingConsensusMode(false);
    }
  };

  const handleFrozenConsensusModeChange = async (matchNumber: number, mode: ConsensusMode) => {
    if (predictionId == null || publicMode) return;
    setSavingFrozenConsensus(true);
    setError(null);
    try {
      const next = await api.setFrozenMatchConsensusMode(predictionId, matchNumber, mode);
      setMasterStateBase(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update locked consensus');
    } finally {
      setSavingFrozenConsensus(false);
    }
  };

  const runPredictionDraw = async () => {
    if (predictionId == null || publicMode) return;
    setDrawingPrediction(true);
    setError(null);
    try {
      const next = await api.drawPrediction(predictionId);
      setMasterStateBase(next);
      const count = next.draw?.matchCount ?? 0;
      setToast(`Drew ${count.toLocaleString()} fixture${count === 1 ? '' : 's'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draw prediction scores');
    } finally {
      setDrawingPrediction(false);
      setShowDrawConfirm(false);
    }
  };

  const handleDrawButton = () => {
    if (publicMode || predictionId == null) return;

    if (consensusModeDraft === 'draw') {
      if (masterStateBase?.draw?.drawnAt) {
        setShowDrawConfirm(true);
      } else {
        void runPredictionDraw();
      }
      return;
    }

    setConsensusModeDraft('draw');
    if (!masterStateBase?.draw?.drawnAt) {
      void runPredictionDraw();
    }
  };

  const consensusModeDirty = consensusModeDraft !== consensusModeSaved;

  const handleSimulateGroup = async (games: 1 | 2 | 3) => {
    if (simulationId == null || !state) return;
    setSimulating(true);
    setError(null);
    try {
      if (publicMode) {
        const { state: nextState, result } = simulateLocalGroupPhase(
          state,
          games,
          upsetVariance,
          ratingEloWeight,
        );
        setState(nextState);
        setToast(
          `Round ${games}: simulated ${result.matchesPlayed} group matches (${result.matchesSkipped} skipped)`,
        );
      } else {
        const result = await api.simulateGroupPhase(
          simulationId,
          games,
          upsetVariance,
        );
        await refreshState(simulationId);
        if (appView === 'predictions') await refreshMasterState();
        setToast(
          `Round ${games}: simulated ${result.matchesPlayed} group matches (${result.matchesSkipped} skipped)`,
        );
      }
    } catch (err) {
      setError(
        err instanceof LocalSimulationError || err instanceof Error
          ? err.message
          : 'Failed to simulate group phase',
      );
    } finally {
      setSimulating(false);
    }
  };

  const handleSimulateKnockouts = async (throughRound: string) => {
    if (simulationId == null || !state) return;
    setSimulating(true);
    setError(null);
    try {
      if (publicMode) {
        const { state: nextState, result } = simulateLocalKnockouts(
          state,
          throughRound,
          upsetVariance,
          ratingEloWeight,
        );
        setState(nextState);
        setToast(
          `Simulated ${result.matchesPlayed} knockout matches across ${result.roundsPlayed} rounds`,
        );
      } else {
        const result = await api.simulateKnockouts(
          simulationId,
          throughRound,
          upsetVariance,
        );
        await refreshState(simulationId);
        setToast(
          `Simulated ${result.matchesPlayed} knockout matches across ${result.roundsPlayed} rounds`,
        );
      }
    } catch (err) {
      setError(
        err instanceof LocalSimulationError || err instanceof Error
          ? err.message
          : 'Failed to simulate knockouts',
      );
    } finally {
      setSimulating(false);
    }
  };

  const handleMonteCarlo = async (count: number) => {
    setBulkSimulating(true);
    setMonteCarloError(null);
    setMonteCarloResult(null);
    setMonteCarloProgress({ completed: 0, total: count });
    try {
      const result = await api.simulateMonteCarlo(
        count,
        upsetVariance,
        (completed, total) => {
          setMonteCarloProgress({ completed, total });
        },
      );
      setMonteCarloResult(result);
      const selection =
        result.firstSimulationId === result.lastSimulationId
          ? String(result.firstSimulationId)
          : `${result.firstSimulationId}-${result.lastSimulationId}`;
      await handleCreatePrediction(result.batchName, selection);
      if (appView !== 'predictions') {
        await switchAppView('predictions');
      }
      setShowMonteCarlo(false);
      setToast(
        `Created prediction "${result.batchName}" from ${result.count.toLocaleString()} simulations`,
      );
    } catch (err) {
      setMonteCarloError(err instanceof Error ? err.message : 'Failed to run bulk simulation');
    } finally {
      setBulkSimulating(false);
      setMonteCarloProgress(null);
    }
  };

  const handleSimulateMatch = async (matchNumber: number) => {
    if (simulationId == null || !state) return;
    setSimulating(true);
    setError(null);
    try {
      if (publicMode) {
        const { state: nextState, result } = simulateLocalMatch(
          state,
          matchNumber,
          upsetVariance,
          ratingEloWeight,
        );
        setState(nextState);
        setEditingMatchNumber(null);
        setToast(`Match #${result.matchNumber}: ${result.goalsHome}–${result.goalsAway}`);
      } else {
        const result = await api.simulateMatch(
          simulationId,
          matchNumber,
          upsetVariance,
        );
        await refreshState(simulationId);
        if (appView === 'predictions') await refreshMasterState();
        setEditingMatchNumber(null);
        setToast(`Match #${result.matchNumber}: ${result.goalsHome}–${result.goalsAway}`);
      }
    } catch (err) {
      setError(
        err instanceof LocalSimulationError || err instanceof Error
          ? err.message
          : 'Failed to simulate match',
      );
    } finally {
      setSimulating(false);
    }
  };

  if (loading) {
    return <div className="app-loading">Loading WC 2026 Simulator…</div>;
  }

  if (error && !state) {
    return <div className="app-error">{error}</div>;
  }

  if (!state || simulationId == null) {
    return <div className="app-error">No simulation loaded</div>;
  }

  return (
    <div className="app">
      <Header
        state={state}
        appView={appView}
        showGroupView={showGroupView}
        publicMode={publicMode}
        consensusMode={consensusModeDraft}
        consensusModeDirty={consensusModeDirty}
        savingConsensusMode={savingConsensusMode}
        activePredictionLabel={activePredictionLabel}
        simulating={simulating}
        upsetVariance={upsetVariance}
        ratingEloWeight={ratingEloWeight}
        onAppViewChange={switchAppView}
        onUpsetVarianceChange={setUpsetVariance}
        onRatingEloWeightChange={handleRatingEloWeightChange}
        onConsensusModeChange={handleConsensusModeChange}
        onSaveConsensusMode={handleSaveConsensusMode}
        onToggleStageView={() => setViewKnockout((v) => !v)}
        onOpenSimulations={() => setShowSimulations(true)}
        onOpenRatings={() => setShowRatings(true)}
        onSimulateGroupGames={handleSimulateGroup}
        onSimulateKnockoutsThrough={handleSimulateKnockouts}
        onOpenMonteCarlo={() => {
          setMonteCarloError(null);
          setShowMonteCarlo(true);
        }}
        onOpenMasterTeamStats={() => setShowMasterTeamStats(true)}
        onOpenTournamentStats={() => setShowTournamentStats(true)}
        onOpenPredictions={() => setShowPredictions(true)}
        onClearSimulation={publicMode ? handleClearSimulation : undefined}
        drawActive={consensusModeDraft === 'draw'}
        hasSavedDraw={Boolean(masterStateBase?.draw?.drawnAt)}
        canDraw={canDrawPrediction}
        drawing={drawingPrediction}
        onDraw={publicMode ? undefined : handleDrawButton}
      />

      {toast && (
        <div className="app-toast app-toast-success" onClick={() => setToast(null)}>
          {toast} (click to dismiss)
        </div>
      )}

      {error && (
        <div className="app-toast" onClick={() => setError(null)}>
          {error} (click to dismiss)
        </div>
      )}

      <main className="app-main">
        {appView === 'predictions' && predictionId == null ? (
          <div className="master-empty">
            <p>No predictions configured yet.</p>
            {!publicMode && (
              <button type="button" className="btn" onClick={() => setShowPredictions(true)}>
                Manage Predictions
              </button>
            )}
          </div>
        ) : appView === 'predictions' && masterState ? (
          <MasterGroupView
            predictionId={predictionId}
            masterState={masterState}
            fixtures={state.fixtures}
            groupMemberships={state.groupMemberships}
            actualResults={state?.actualResults ?? []}
            canEditFrozenConsensus={!publicMode}
            savingFrozenConsensus={savingFrozenConsensus}
            onFrozenConsensusModeChange={handleFrozenConsensusModeChange}
          />
        ) : appView === 'results' && !publicMode && actualState ? (
          <ActualResultsView
            actualState={actualState}
            selectedMatchNumber={selectedMatchNumber}
            editingMatchNumber={editingMatchNumber}
            onSelectMatch={setSelectedMatchNumber}
            onStartEdit={setEditingMatchNumber}
            onSaveScore={handleSaveActualScore}
            onCancelEdit={() => setEditingMatchNumber(null)}
            onClearScore={handleClearActualScore}
          />
        ) : showGroupView ? (
          <GroupPhaseView
            state={state}
            selectedMatchNumber={selectedMatchNumber}
            editingMatchNumber={editingMatchNumber}
            simulating={simulating}
            onSelectMatch={setSelectedMatchNumber}
            onStartEdit={setEditingMatchNumber}
            onSimulateMatch={handleSimulateMatch}
            onSaveScore={handleSaveScore}
            onCancelEdit={() => setEditingMatchNumber(null)}
            onClearScore={handleClearScore}
          />
        ) : (
          <KnockoutView
            state={state}
            useBracketView={knockoutBracketView}
            onViewChange={setKnockoutBracketView}
            selectedMatchNumber={selectedMatchNumber}
            editingMatchNumber={editingMatchNumber}
            simulating={simulating}
            onSelectMatch={setSelectedMatchNumber}
            onStartEdit={setEditingMatchNumber}
            onSimulateMatch={handleSimulateMatch}
            onSaveScore={handleSaveScore}
            onCancelEdit={() => setEditingMatchNumber(null)}
            onClearScore={handleClearScore}
          />
        )}
      </main>

      {publicMode && publicMeta && (
        <footer className="app-footer muted">
          Prediction data as of {new Date(publicMeta.exportedAt).toLocaleString()}
        </footer>
      )}

      {showPredictions && (
        <PredictionManagerModal
          activePredictionId={predictionId}
          onClose={() => setShowPredictions(false)}
          onSwitch={switchPrediction}
          onCreate={handleCreatePrediction}
          onRename={handleRenamePrediction}
          onDelete={handleDeletePrediction}
        />
      )}

      {showSimulations && (
        <SimulationManagerModal
          activeSimulationId={simulationId}
          onClose={() => setShowSimulations(false)}
          onSwitch={switchSimulation}
          onCreate={handleCreateSimulation}
          onRename={handleRenameSimulation}
          onDelete={handleDeleteSimulation}
        />
      )}

      {showRatings && (
        <TeamRatingsModal
          teams={teams.length > 0 ? teams : Object.values(state.teams)}
          ratingEloWeight={ratingEloWeight}
          onClose={() => setShowRatings(false)}
        />
      )}

      {showMonteCarlo && (
        <MonteCarloModal
          running={bulkSimulating}
          progress={monteCarloProgress}
          result={monteCarloResult}
          error={monteCarloError}
          upsetVariance={upsetVariance}
          ratingEloWeight={ratingEloWeight}
          onUpsetVarianceChange={setUpsetVariance}
          onRatingEloWeightChange={handleRatingEloWeightChange}
          onClose={() => setShowMonteCarlo(false)}
          onRun={handleMonteCarlo}
        />
      )}

      {showMasterTeamStats && (
        <MasterTeamStatsModal
          predictionId={predictionId}
          allowRebuild={!publicMode}
          onClose={() => setShowMasterTeamStats(false)}
        />
      )}

      {showDrawConfirm && (
        <DrawConfirmModal
          onConfirm={() => void runPredictionDraw()}
          onClose={() => setShowDrawConfirm(false)}
        />
      )}

      {showTournamentStats && state && (
        <TournamentStatsModal
          source={
            appView === 'predictions' && masterState
              ? {
                  kind: 'prediction',
                  masterState,
                  fixtures: state.fixtures,
                  consensusMode: publicMode ? masterState.consensusMode : consensusModeDraft,
                }
              : { kind: 'simulation', state }
          }
          onClose={() => setShowTournamentStats(false)}
        />
      )}
    </div>
  );
}
