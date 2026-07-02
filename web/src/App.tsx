import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  findKnockoutRoundNameForMatch,
  knockoutMatchNumbersAfterRound,
} from '@shared/engine/predictionKnockout.js';
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
  MasterKnockoutState,
  PublicMeta,
  Team,
  ThirdPlaceOrderRow,
  TournamentState,
} from './types.js';
import { Header } from './components/Header.js';
import { ActualResultsView } from './components/ActualResultsView.js';
import { ActualResultsKnockoutView } from './components/ActualResultsKnockoutView.js';
import { GroupPhaseView } from './components/GroupPhaseView.js';
import { KnockoutView } from './components/KnockoutView.js';
import { MasterGroupView } from './components/MasterGroupView.js';
import { MasterKnockoutView } from './components/MasterKnockoutView.js';
import { MonteCarloModal } from './components/MonteCarloModal.js';
import type { AppView } from './lib/appView.js';
import { DEFAULT_UPSET_VARIANCE } from './lib/upsetVariance.js';
import { DEFAULT_RATING_ELO_WEIGHT, loadStoredRatingEloWeight, storeRatingEloWeight } from './lib/ratingEloWeight.js';
import {
  DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT,
  loadStoredTournamentEloDeltaWeight,
  storeTournamentEloDeltaWeight,
} from './lib/tournamentEloDeltaWeight.js';
import {
  DEFAULT_CONSENSUS_MODE,
  loadStoredConsensusMode,
  type ConsensusMode,
} from './lib/consensusMode.js';
import { applyConsensusMode } from './lib/applyConsensusMode.js';
import { inheritFixedDoubleDowns, inheritKnockoutR32FixedDoubleDowns } from './lib/fixedDoubleDowns.js';
import { applyRatingEloWeightToStateTeams } from './lib/normalizeTeam.js';
import { applyBlendRatingsToTeams } from '@shared/engine/teamRatings.js';
import { areThirdPlaceTeamsTiedOnStats } from '@shared/engine/thirdPlaceOrder.js';
import { MOBILE_QUERY } from './lib/useMediaQuery.js';
import { SimulationManagerModal } from './components/SimulationManagerModal.js';
import { PredictionManagerModal } from './components/PredictionManagerModal.js';
import { TeamRatingsModal } from './components/TeamRatingsModal.js';
import { MasterTeamStatsModal } from './components/MasterTeamStatsModal.js';
import { TournamentStatsModal } from './components/TournamentStatsModal.js';
import { SampleConfirmModal } from './components/SampleConfirmModal.js';
import { KnockoutClearConfirmModal } from './components/KnockoutClearConfirmModal.js';
import {
  DEFAULT_PREDICTION_KNOCKOUT_MC_COUNT,
  PredictionKnockoutBulkModal,
} from './components/PredictionKnockoutBulkModal.js';
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
  const [viewKnockout, setViewKnockout] = useState(true);
  const [predictionsViewKnockout, setPredictionsViewKnockout] = useState(true);
  const [appView, setAppView] = useState<AppView>(publicMode ? 'simulations' : 'predictions');
  const [actualState, setActualState] = useState<ActualResultsState | null>(null);
  const [knockoutBracketView, setKnockoutBracketView] = useState(
    () => typeof window !== 'undefined' && !window.matchMedia(MOBILE_QUERY).matches,
  );
  const [masterStateBase, setMasterStateBase] = useState<MasterGroupState | null>(null);
  const [masterKnockoutState, setMasterKnockoutState] = useState<MasterKnockoutState | null>(null);
  const [consensusModeDraft, setConsensusModeDraft] = useState<ConsensusMode>(DEFAULT_CONSENSUS_MODE);
  const [consensusModeSaved, setConsensusModeSaved] = useState<ConsensusMode>(DEFAULT_CONSENSUS_MODE);
  const [savingConsensusMode, setSavingConsensusMode] = useState(false);
  const [savingFrozenConsensus, setSavingFrozenConsensus] = useState(false);
  const [predictionId, setPredictionId] = useState<number | null>(null);
  const [activePredictionLabel, setActivePredictionLabel] = useState<string | null>(null);
  const [showMasterTeamStats, setShowMasterTeamStats] = useState(false);
  const [showTournamentStats, setShowTournamentStats] = useState(false);
  const [showResampleConfirm, setShowResampleConfirm] = useState(false);
  const [samplingPrediction, setSamplingPrediction] = useState(false);
  const [resamplingMatchNumber, setResamplingMatchNumber] = useState<number | null>(null);
  const [simulatingPredictionKnockout, setSimulatingPredictionKnockout] = useState(false);
  const [showPredictionKnockoutBulk, setShowPredictionKnockoutBulk] = useState(false);
  const [predictionKnockoutMcCount, setPredictionKnockoutMcCount] = useState(
    DEFAULT_PREDICTION_KNOCKOUT_MC_COUNT,
  );
  const [predictionKnockoutBulkError, setPredictionKnockoutBulkError] = useState<string | null>(null);
  const [predictionKnockoutBulkProgress, setPredictionKnockoutBulkProgress] = useState<{
    roundLabel: string;
    matchCount: number;
    simulationCount: number;
  } | null>(null);
  const [showKnockoutClearConfirm, setShowKnockoutClearConfirm] = useState(false);
  const [knockoutClearAction, setKnockoutClearAction] = useState<(() => void) | null>(null);
  const [knockoutResampleConfirm, setKnockoutResampleConfirm] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [exportingPublic, setExportingPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [publicMeta, setPublicMeta] = useState<PublicMeta | null>(null);
  const [upsetVariance, setUpsetVariance] = useState(DEFAULT_UPSET_VARIANCE);
  const [ratingEloWeight, setRatingEloWeight] = useState(
    publicMode ? loadStoredRatingEloWeight() : DEFAULT_RATING_ELO_WEIGHT,
  );
  const [tournamentEloDeltaWeight, setTournamentEloDeltaWeight] = useState(
    publicMode ? loadStoredTournamentEloDeltaWeight() : DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT,
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

  const refreshMasterKnockoutState = useCallback(async (id?: number | null) => {
    const pid = id ?? predictionId;
    if (pid == null) {
      setMasterKnockoutState(null);
      return null;
    }
    try {
      const next = await api.getMasterKnockoutState(pid);
      setMasterKnockoutState(next);
      return next;
    } catch {
      setMasterKnockoutState(null);
      return null;
    }
  }, [predictionId]);

  const refreshMasterState = useCallback(async (id?: number | null) => {
    const pid = id ?? predictionId;
    if (pid == null) {
      setMasterStateBase(null);
      setMasterKnockoutState(null);
      return null;
    }
    const next = await api.getMasterGroupState(pid);
    setMasterStateBase(next);
    const saved = next.consensusMode;
    setConsensusModeSaved(saved);
    const stored = !publicMode ? loadStoredConsensusMode(pid) : null;
    setConsensusModeDraft(stored ?? saved);
    await refreshMasterKnockoutState(pid);
    return next;
  }, [predictionId, publicMode, refreshMasterKnockoutState]);

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

  const effectiveMasterKnockoutState = useMemo(() => masterKnockoutState, [masterKnockoutState]);

  const canSamplePrediction = useMemo(() => {
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
        const [simulationLoad, initialPrediction, meta, settings, tournamentFormSettings] =
          await Promise.all([
          loadInitialSimulation(),
          loadInitialPrediction(),
          publicMode ? loadPublicMeta() : Promise.resolve(null),
          publicMode ? Promise.resolve(null) : api.getRatingEloWeight(),
          publicMode ? Promise.resolve(null) : api.getTournamentEloDeltaWeight(),
        ]);
        const { id, state: initialState } = simulationLoad;
        const weight = publicMode
          ? loadStoredRatingEloWeight()
          : (settings?.ratingEloWeight ?? DEFAULT_RATING_ELO_WEIGHT);
        const deltaWeight = publicMode
          ? loadStoredTournamentEloDeltaWeight()
          : (tournamentFormSettings?.tournamentEloDeltaWeight ??
            DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT);
        setRatingEloWeight(weight);
        setTournamentEloDeltaWeight(deltaWeight);
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
          try {
            setMasterKnockoutState(await api.getMasterKnockoutState(initialPrediction.id));
          } catch {
            setMasterKnockoutState(null);
          }
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
  const predictionsShowGroupView = !predictionsViewKnockout;
  const headerShowGroupView =
    appView === 'predictions' ? predictionsShowGroupView : showGroupView;

  const confirmIfKnockoutResults = (action: () => void | Promise<void>) => {
    if (effectiveMasterKnockoutState?.hasKnockoutResults) {
      setKnockoutClearAction(() => () => void action());
      setShowKnockoutClearConfirm(true);
      return;
    }
    void action();
  };

  const swapThirdPlaceOrder = (
    rows: ThirdPlaceOrderRow[],
    groupLetter: string,
    direction: 'up' | 'down',
  ): Array<{ groupLetter: string; position: number }> | null => {
    const sorted = [...rows].sort((a, b) => a.position - b.position);
    const index = sorted.findIndex((row) => row.groupLetter === groupLetter);
    if (index < 0) return null;
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= sorted.length) return null;
    const current = sorted[index]!;
    const neighbor = sorted[swapIndex]!;
    if (!areThirdPlaceTeamsTiedOnStats(current, neighbor)) return null;
    return sorted.map((row, rowIndex) => {
      if (rowIndex === index) {
        return { groupLetter: row.groupLetter, position: neighbor.position };
      }
      if (rowIndex === swapIndex) {
        return { groupLetter: row.groupLetter, position: current.position };
      }
      return { groupLetter: row.groupLetter, position: row.position };
    });
  };

  const switchPrediction = async (id: number) => {
    inheritFixedDoubleDowns(predictionId);
    inheritKnockoutR32FixedDoubleDowns(predictionId);
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

  const handleCreatePrediction = async (name: string, selection: string): Promise<number> => {
    inheritFixedDoubleDowns(predictionId);
    inheritKnockoutR32FixedDoubleDowns(predictionId);
    const prediction = await api.createPrediction(name, selection);
    await switchPrediction(prediction.id);
    return prediction.id;
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

  const handleTournamentEloDeltaWeightChange = async (value: number) => {
    setTournamentEloDeltaWeight(value);
    if (publicMode) {
      storeTournamentEloDeltaWeight(value);
      return;
    }
    await api.setTournamentEloDeltaWeight(value);
  };

  const handleConsensusModeChange = (mode: ConsensusMode) => {
    if (publicMode) return;
    setConsensusModeDraft(mode);
  };

  const handleSaveConsensusMode = async () => {
    if (predictionId == null || publicMode) return;
    const save = async () => {
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
    confirmIfKnockoutResults(save);
  };

  const handleExportPublic = async () => {
    if (publicMode) return;
    setExportingPublic(true);
    setError(null);
    try {
      const result = await api.exportPublic();
      setToast(
        `Exported "${result.predictionName}" to ${result.outDir} (${result.exportedAt})`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export public site');
    } finally {
      setExportingPublic(false);
    }
  };

  const handleFrozenConsensusModeChange = async (matchNumber: number, mode: ConsensusMode) => {
    if (predictionId == null || publicMode) return;
    const save = async () => {
      setSavingFrozenConsensus(true);
      setError(null);
      try {
        const next = await api.setFrozenMatchConsensusMode(predictionId, matchNumber, mode);
        setMasterStateBase(next);
        await refreshMasterKnockoutState(predictionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update locked consensus');
      } finally {
        setSavingFrozenConsensus(false);
      }
    };
    confirmIfKnockoutResults(save);
  };

  const runPredictionSample = async () => {
    if (predictionId == null || publicMode) return;
    const sample = async () => {
      setSamplingPrediction(true);
      setError(null);
      try {
        const next = await api.samplePrediction(predictionId);
        setMasterStateBase(next);
        await refreshMasterKnockoutState(predictionId);
        const count = next.sample?.matchCount ?? 0;
        setToast(`Sampled ${count.toLocaleString()} fixture${count === 1 ? '' : 's'}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to sample prediction scores');
      } finally {
        setSamplingPrediction(false);
        setShowResampleConfirm(false);
      }
    };
    if (effectiveMasterKnockoutState?.hasKnockoutResults) {
      setKnockoutClearAction(() => () => void sample());
      setShowKnockoutClearConfirm(true);
      return;
    }
    await sample();
  };

  const runPredictionSampleMatch = (matchNumber: number) => {
    if (predictionId == null || publicMode || consensusModeDraft !== 'sample') return;
    const resample = async () => {
      setResamplingMatchNumber(matchNumber);
      setError(null);
      try {
        const next = await api.samplePredictionMatch(predictionId, matchNumber);
        setMasterStateBase(next);
        await refreshMasterKnockoutState(predictionId);
        setToast(`Resampled match ${matchNumber}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to resample fixture');
      } finally {
        setResamplingMatchNumber(null);
      }
    };
    confirmIfKnockoutResults(resample);
  };

  const knockoutSimOptions = {
    count: predictionKnockoutMcCount,
    upsetVariance,
    ratingEloWeight,
    tournamentEloDeltaWeight,
  };

  const knockoutMatchClearsLaterRounds = (matchNumber: number) => {
    const roundName = findKnockoutRoundNameForMatch(matchNumber);
    if (!roundName || !effectiveMasterKnockoutState) return false;
    const laterMatches = new Set(knockoutMatchNumbersAfterRound(roundName));
    return effectiveMasterKnockoutState.resolvedMatches.some(
      (match) =>
        laterMatches.has(match.fixture.matchNumber) &&
        match.result.status === 'played' &&
        !(state?.actualResults ?? []).some(
          (result) => result.matchNumber === match.fixture.matchNumber,
        ),
    );
  };

  const executePredictionKnockoutResampleMatch = async (matchNumber: number) => {
    if (predictionId == null || publicMode) return;
    setResamplingMatchNumber(matchNumber);
    setError(null);
    try {
      const next = await api.resimulatePredictionKnockoutMatch(
        predictionId,
        matchNumber,
        knockoutSimOptions,
      );
      setMasterKnockoutState(next);
      setToast(`Resampled match ${matchNumber}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resample knockout match');
    } finally {
      setResamplingMatchNumber(null);
    }
  };

  const runPredictionKnockoutResampleMatch = (matchNumber: number) => {
    if (predictionId == null || publicMode) return;
    if (knockoutMatchClearsLaterRounds(matchNumber)) {
      setKnockoutResampleConfirm(matchNumber);
      return;
    }
    void executePredictionKnockoutResampleMatch(matchNumber);
  };

  const handleSampleButton = () => {
    if (publicMode || predictionId == null) return;

    if (appView === 'predictions' && predictionsViewKnockout) {
      void handleResampleLastKnockoutRound();
      return;
    }

    if (consensusModeDraft === 'sample') {
      if (masterStateBase?.sample?.sampledAt) {
        if (effectiveMasterKnockoutState?.hasKnockoutResults) {
          setKnockoutClearAction(() => () => setShowResampleConfirm(true));
          setShowKnockoutClearConfirm(true);
        } else {
          setShowResampleConfirm(true);
        }
      } else {
        void runPredictionSample();
      }
      return;
    }

    setConsensusModeDraft('sample');
    if (!masterStateBase?.sample?.sampledAt) {
      void runPredictionSample();
    }
  };

  const persistThirdPlaceOrder = async (
    order: Array<{ groupLetter: string; position: number }>,
  ) => {
    if (publicMode) return;
    setError(null);
    try {
      const next = await api.setActualThirdPlaceOrder(order);
      setActualState(next);
      if (predictionId != null) await refreshMasterKnockoutState(predictionId);
      if (simulationId != null) await refreshState(simulationId);
      setToast('Third-place order updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update third-place order');
    }
  };

  const handleMoveThirdPlace = (groupLetter: string, direction: 'up' | 'down') => {
    if (!actualState?.thirdPlaceOrder) return;
    const nextOrder = swapThirdPlaceOrder(actualState.thirdPlaceOrder, groupLetter, direction);
    if (!nextOrder) {
      setError('Can only reorder teams tied on points, goal difference, and goals scored');
      return;
    }
    const apply = () => void persistThirdPlaceOrder(nextOrder);
    confirmIfKnockoutResults(apply);
  };

  const handleSimulatePredictionKnockoutRound = async (
    roundName: string,
    options?: { resimulate?: boolean },
  ) => {
    if (predictionId == null || publicMode) return;
    setSimulatingPredictionKnockout(true);
    setError(null);
    try {
      const next = await api.simulatePredictionKnockoutRound(predictionId, roundName, {
        ...knockoutSimOptions,
        resimulate: options?.resimulate ?? false,
      });
      setMasterKnockoutState(next);
      const round = next.rounds.find((entry) => entry.name === roundName);
      setToast(
        options?.resimulate
          ? `${round?.label ?? roundName} re-sampled (${predictionKnockoutMcCount.toLocaleString()} draws per match)`
          : `${round?.label ?? roundName} simulated`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to simulate knockout round');
    } finally {
      setSimulatingPredictionKnockout(false);
    }
  };

  const lastSimulatedKnockoutRound = useMemo(() => {
    if (!masterKnockoutState) return null;
    for (let index = masterKnockoutState.rounds.length - 1; index >= 0; index -= 1) {
      const round = masterKnockoutState.rounds[index];
      if (round?.isComplete) return round;
    }
    return null;
  }, [masterKnockoutState]);

  const handleResampleLastKnockoutRound = async () => {
    if (!lastSimulatedKnockoutRound) return;
    await handleSimulatePredictionKnockoutRound(lastSimulatedKnockoutRound.name, {
      resimulate: true,
    });
  };

  const handleBulkSimulatePredictionKnockout = async (
    roundName: string,
    count: number,
    resimulate: boolean,
  ) => {
    if (predictionId == null || publicMode || !masterKnockoutState) return;

    const round = masterKnockoutState.rounds.find((entry) => entry.name === roundName);
    if (!round) return;

    setSimulatingPredictionKnockout(true);
    setPredictionKnockoutBulkError(null);
    setPredictionKnockoutMcCount(count);
    setError(null);
    setPredictionKnockoutBulkProgress({
      roundLabel: round.label,
      matchCount: round.matches.length,
      simulationCount: count,
    });

    try {
      const next = await api.simulatePredictionKnockoutRound(predictionId, roundName, {
        count,
        upsetVariance,
        ratingEloWeight,
        tournamentEloDeltaWeight,
        resimulate,
      });
      setMasterKnockoutState(next);
      setToast(
        resimulate
          ? `${round.label} re-simulated (${count.toLocaleString()} draws per match)`
          : `${round.label} simulated (${count.toLocaleString()} draws per match)`,
      );
      setShowPredictionKnockoutBulk(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to simulate knockout round';
      setPredictionKnockoutBulkError(message);
      setError(message);
    } finally {
      setSimulatingPredictionKnockout(false);
      setPredictionKnockoutBulkProgress(null);
    }
  };

  const handleClearPredictionKnockout = async () => {
    if (predictionId == null || publicMode) return;
    setSimulatingPredictionKnockout(true);
    setError(null);
    try {
      const next = await api.clearPredictionKnockout(predictionId);
      setMasterKnockoutState(next);
      setToast('Knockout results cleared');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear knockout results');
    } finally {
      setSimulatingPredictionKnockout(false);
    }
  };

  const handleSelectKnockoutRun = async (simulationId: number | null) => {
    if (predictionId == null || publicMode) return;
    setError(null);
    try {
      const next = await api.setPredictionActiveKnockoutSimulation(predictionId, simulationId);
      setMasterKnockoutState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load knockout run');
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
          tournamentEloDeltaWeight,
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
          tournamentEloDeltaWeight,
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
        setSelectedMatchNumber(null);
        setEditingMatchNumber(null);
        setAppView('predictions');
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
          tournamentEloDeltaWeight,
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
        showGroupView={headerShowGroupView}
        publicMode={publicMode}
        consensusMode={consensusModeDraft}
        consensusModeDirty={consensusModeDirty}
        savingConsensusMode={savingConsensusMode}
        activePredictionLabel={activePredictionLabel}
        simulating={simulating}
        upsetVariance={upsetVariance}
        ratingEloWeight={ratingEloWeight}
        tournamentEloDeltaWeight={tournamentEloDeltaWeight}
        onAppViewChange={switchAppView}
        onUpsetVarianceChange={setUpsetVariance}
        onRatingEloWeightChange={handleRatingEloWeightChange}
        onTournamentEloDeltaWeightChange={handleTournamentEloDeltaWeightChange}
        onConsensusModeChange={handleConsensusModeChange}
        onSaveConsensusMode={handleSaveConsensusMode}
        onToggleStageView={() => {
          if (appView === 'predictions') {
            setPredictionsViewKnockout((value) => !value);
          } else {
            setViewKnockout((value) => !value);
          }
        }}
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
        onExportPublic={publicMode ? undefined : handleExportPublic}
        exportingPublic={exportingPublic}
        onClearSimulation={publicMode ? handleClearSimulation : undefined}
        sampleActive={consensusModeDraft === 'sample'}
        hasSavedSample={Boolean(masterStateBase?.sample?.sampledAt)}
        canSample={canSamplePrediction}
        canResampleKnockoutRound={lastSimulatedKnockoutRound != null}
        sampling={samplingPrediction}
        simulatingPredictionKnockout={simulatingPredictionKnockout}
        onSample={publicMode ? undefined : handleSampleButton}
        predictionKnockoutRounds={effectiveMasterKnockoutState?.rounds}
        predictionGroupStageComplete={effectiveMasterKnockoutState?.groupStageComplete ?? false}
        predictionHasKnockoutResults={effectiveMasterKnockoutState?.hasKnockoutResults ?? false}
        onSimulatePredictionKnockoutRound={
          publicMode ? undefined : handleSimulatePredictionKnockoutRound
        }
        onOpenPredictionKnockoutBulk={
          publicMode
            ? undefined
            : () => {
                setPredictionKnockoutBulkError(null);
                setShowPredictionKnockoutBulk(true);
              }
        }
        onClearPredictionKnockout={
          publicMode ? undefined : () => void handleClearPredictionKnockout()
        }
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
          predictionsShowGroupView ? (
            <MasterGroupView
              predictionId={predictionId}
              masterState={masterState}
              fixtures={state.fixtures}
              groupMemberships={state.groupMemberships}
              actualResults={state?.actualResults ?? []}
              thirdPlaceOrder={effectiveMasterKnockoutState?.thirdPlaceOrder}
              canEditThirdPlace={false}
              canEditFrozenConsensus={!publicMode}
              savingFrozenConsensus={savingFrozenConsensus}
              onFrozenConsensusModeChange={handleFrozenConsensusModeChange}
              sampleActive={consensusModeDraft === 'sample' && !publicMode}
              onResampleMatch={runPredictionSampleMatch}
              resamplingMatchNumber={resamplingMatchNumber}
            />
          ) : effectiveMasterKnockoutState ? (
            <MasterKnockoutView
              predictionId={predictionId}
              masterKnockoutState={effectiveMasterKnockoutState}
              useBracketView={knockoutBracketView}
              onViewChange={setKnockoutBracketView}
              selectedMatchNumber={selectedMatchNumber}
              simulating={simulatingPredictionKnockout}
              consensusModeDirty={consensusModeDirty}
              actualResults={state?.actualResults ?? []}
              onSelectMatch={setSelectedMatchNumber}
              onSelectKnockoutRun={
                publicMode ? undefined : (id) => void handleSelectKnockoutRun(id)
              }
              onResampleMatch={
                publicMode ? undefined : runPredictionKnockoutResampleMatch
              }
              resamplingMatchNumber={resamplingMatchNumber}
            />
          ) : (
            <div className="master-empty">
              <p>Loading knockout state…</p>
            </div>
          )
        ) : appView === 'results' && !publicMode && actualState ? (
          showGroupView ? (
            <ActualResultsView
              actualState={actualState}
              selectedMatchNumber={selectedMatchNumber}
              editingMatchNumber={editingMatchNumber}
              canEditThirdPlace
              onMoveThirdPlaceUp={(groupLetter) => handleMoveThirdPlace(groupLetter, 'up')}
              onMoveThirdPlaceDown={(groupLetter) => handleMoveThirdPlace(groupLetter, 'down')}
              onSelectMatch={setSelectedMatchNumber}
              onStartEdit={setEditingMatchNumber}
              onSaveScore={handleSaveActualScore}
              onCancelEdit={() => setEditingMatchNumber(null)}
              onClearScore={handleClearActualScore}
            />
          ) : (
            <ActualResultsKnockoutView
              actualState={actualState}
              useBracketView={knockoutBracketView}
              onViewChange={setKnockoutBracketView}
              selectedMatchNumber={selectedMatchNumber}
              editingMatchNumber={editingMatchNumber}
              onSelectMatch={setSelectedMatchNumber}
              onStartEdit={setEditingMatchNumber}
              onSaveScore={handleSaveActualScore}
              onCancelEdit={() => setEditingMatchNumber(null)}
              onClearScore={handleClearActualScore}
            />
          )
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
          tournamentEloDeltaWeight={tournamentEloDeltaWeight}
          onUpsetVarianceChange={setUpsetVariance}
          onRatingEloWeightChange={handleRatingEloWeightChange}
          onTournamentEloDeltaWeightChange={handleTournamentEloDeltaWeightChange}
          onClose={() => setShowMonteCarlo(false)}
          onRun={handleMonteCarlo}
        />
      )}

      {showPredictionKnockoutBulk && masterKnockoutState && (
        <PredictionKnockoutBulkModal
          running={simulatingPredictionKnockout}
          progress={predictionKnockoutBulkProgress}
          error={predictionKnockoutBulkError}
          rounds={masterKnockoutState.rounds}
          groupStageComplete={masterKnockoutState.groupStageComplete}
          consensusMode={consensusModeSaved}
          consensusModeDirty={consensusModeDirty}
          upsetVariance={upsetVariance}
          ratingEloWeight={ratingEloWeight}
          tournamentEloDeltaWeight={tournamentEloDeltaWeight}
          mcCount={predictionKnockoutMcCount}
          onUpsetVarianceChange={setUpsetVariance}
          onRatingEloWeightChange={handleRatingEloWeightChange}
          onTournamentEloDeltaWeightChange={handleTournamentEloDeltaWeightChange}
          onMcCountChange={setPredictionKnockoutMcCount}
          onClose={() => {
            if (!simulatingPredictionKnockout) {
              setShowPredictionKnockoutBulk(false);
              setPredictionKnockoutBulkError(null);
            }
          }}
          onRun={handleBulkSimulatePredictionKnockout}
        />
      )}

      {showMasterTeamStats && (
        <MasterTeamStatsModal
          predictionId={predictionId}
          allowRebuild={!publicMode}
          onClose={() => setShowMasterTeamStats(false)}
        />
      )}

      {showResampleConfirm && (
        <SampleConfirmModal
          onConfirm={() => void runPredictionSample()}
          onClose={() => setShowResampleConfirm(false)}
        />
      )}

      {knockoutResampleConfirm != null && (
        <KnockoutClearConfirmModal
          title="Clear later knockout rounds?"
          message="Re-sampling this match may change who advances. Simulated results in later rounds will be cleared."
          confirmLabel="Resample"
          onConfirm={() => {
            const matchNumber = knockoutResampleConfirm;
            setKnockoutResampleConfirm(null);
            void executePredictionKnockoutResampleMatch(matchNumber);
          }}
          onClose={() => setKnockoutResampleConfirm(null)}
        />
      )}

      {showKnockoutClearConfirm && (
        <KnockoutClearConfirmModal
          title="Clear knockout results?"
          message="Changing group standings or third-place teams will clear all simulated knockout results for this prediction."
          confirmLabel="Continue"
          onConfirm={() => {
            setShowKnockoutClearConfirm(false);
            knockoutClearAction?.();
            setKnockoutClearAction(null);
          }}
          onClose={() => {
            setShowKnockoutClearConfirm(false);
            setKnockoutClearAction(null);
          }}
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
