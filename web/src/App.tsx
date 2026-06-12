import { useCallback, useEffect, useState } from 'react';
import { isKnockoutStagePhase } from '@shared/engine/phase.js';
import { api, isPublicMode, loadInitialSimulation } from './api/client.js';
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
import { MOBILE_QUERY } from './lib/useMediaQuery.js';
import { SimulationManagerModal } from './components/SimulationManagerModal.js';
import { TeamRatingsModal } from './components/TeamRatingsModal.js';
import { MasterTeamStatsModal } from './components/MasterTeamStatsModal.js';
import type { MonteCarloResult } from './types.js';

export function App() {
  const publicMode = isPublicMode();
  const [simulationId, setSimulationId] = useState<number | null>(null);
  const [state, setState] = useState<TournamentState | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [layout, setLayout] = useState<'horizontal' | 'vertical'>('vertical');
  const [selectedMatchNumber, setSelectedMatchNumber] = useState<number | null>(null);
  const [editingMatchNumber, setEditingMatchNumber] = useState<number | null>(null);
  const [showSimulations, setShowSimulations] = useState(false);
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
  const [masterState, setMasterState] = useState<MasterGroupState | null>(null);
  const [showMasterTeamStats, setShowMasterTeamStats] = useState(false);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [publicMeta, setPublicMeta] = useState<PublicMeta | null>(null);
  const [upsetVariance, setUpsetVariance] = useState(DEFAULT_UPSET_VARIANCE);

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

  const refreshMasterState = useCallback(async () => {
    const next = await api.getMasterGroupState();
    setMasterState(next);
    return next;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [{ id, state: initialState }, master, meta] = await Promise.all([
          loadInitialSimulation(),
          api.getMasterGroupState(),
          publicMode ? loadPublicMeta() : Promise.resolve(null),
        ]);
        setSimulationId(id);
        setState(initialState);
        setMasterState(master);
        if (publicMode && meta) {
          setPublicMeta(meta);
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

  const phase = state?.simulation.phase ?? 'group';

  useEffect(() => {
    setViewKnockout(isKnockoutStagePhase(phase));
  }, [phase, simulationId]);

  useEffect(() => {
    if (!publicMode || !state || !publicMeta) return;
    persistLocalPrediction(state, publicMeta);
  }, [publicMode, state, publicMeta]);

  const showGroupView = !viewKnockout;

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
      setEditingMatchNumber(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear actual result');
    }
  };

  const switchAppView = async (view: AppView) => {
    if (view === appView) return;
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
      setViewKnockout(isKnockoutStagePhase(fresh.simulation.phase));
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

  const handleUpdateTeamRatings = async (
    teamId: number,
    offensiveRating: number,
    defensiveRating: number,
  ) => {
    await api.updateTeamRatings(teamId, offensiveRating, defensiveRating);
    setTeams(await api.listTeams());
    if (simulationId != null) await refreshState(simulationId);
  };

  const handleSimulateGroup = async (games: 1 | 2 | 3) => {
    if (simulationId == null || !state) return;
    setSimulating(true);
    setError(null);
    try {
      if (publicMode) {
        const { state: nextState, result } = simulateLocalGroupPhase(state, games, upsetVariance);
        setState(nextState);
        setToast(
          `Round ${games}: simulated ${result.matchesPlayed} group matches (${result.matchesSkipped} skipped)`,
        );
      } else {
        const result = await api.simulateGroupPhase(simulationId, games, upsetVariance);
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
        );
        setState(nextState);
        setToast(
          `Simulated ${result.matchesPlayed} knockout matches across ${result.roundsPlayed} rounds`,
        );
      } else {
        const result = await api.simulateKnockouts(simulationId, throughRound, upsetVariance);
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
      const result = await api.simulateMonteCarlo(count, upsetVariance, (completed, total) => {
        setMonteCarloProgress({ completed, total });
      });
      setMonteCarloResult(result);
      if (appView === 'predictions') await refreshMasterState();
      setToast(
        `Bulk simulate: saved ${result.count.toLocaleString()} simulations (#${result.firstSimulationId}–${result.lastSimulationId})`,
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
        const { state: nextState, result } = simulateLocalMatch(state, matchNumber, upsetVariance);
        setState(nextState);
        setEditingMatchNumber(null);
        setToast(`Match #${result.matchNumber}: ${result.goalsHome}–${result.goalsAway}`);
      } else {
        const result = await api.simulateMatch(simulationId, matchNumber, upsetVariance);
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
        layout={layout}
        showGroupView={showGroupView}
        knockoutBracketView={knockoutBracketView}
        publicMode={publicMode}
        masterConsensusMode={masterState?.consensusMode}
        simulating={simulating}
        upsetVariance={upsetVariance}
        onAppViewChange={switchAppView}
        onUpsetVarianceChange={setUpsetVariance}
        onLayoutChange={setLayout}
        onKnockoutBracketViewChange={setKnockoutBracketView}
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
        onClearSimulation={publicMode ? handleClearSimulation : undefined}
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
        {appView === 'predictions' && masterState ? (
          <MasterGroupView masterState={masterState} layout={layout} />
        ) : appView === 'results' && actualState ? (
          <ActualResultsView
            actualState={actualState}
            layout={layout}
            selectedMatchNumber={selectedMatchNumber}
            editingMatchNumber={editingMatchNumber}
            readOnly={publicMode}
            onSelectMatch={setSelectedMatchNumber}
            onStartEdit={setEditingMatchNumber}
            onSaveScore={handleSaveActualScore}
            onCancelEdit={() => setEditingMatchNumber(null)}
            onClearScore={handleClearActualScore}
          />
        ) : showGroupView ? (
          <GroupPhaseView
            state={state}
            layout={layout}
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
          teams={teams}
          onClose={() => setShowRatings(false)}
          onSave={handleUpdateTeamRatings}
        />
      )}

      {showMonteCarlo && (
        <MonteCarloModal
          running={bulkSimulating}
          progress={monteCarloProgress}
          result={monteCarloResult}
          error={monteCarloError}
          upsetVariance={upsetVariance}
          onUpsetVarianceChange={setUpsetVariance}
          onClose={() => setShowMonteCarlo(false)}
          onRun={handleMonteCarlo}
        />
      )}

      {showMasterTeamStats && (
        <MasterTeamStatsModal
          allowRebuild={!publicMode}
          onClose={() => setShowMasterTeamStats(false)}
        />
      )}
    </div>
  );
}
