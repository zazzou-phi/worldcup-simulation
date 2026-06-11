import { isPublicMode } from '../config/appMode.js';
import { hydrateLocalState } from '../lib/localPredictionStorage.js';
import { staticApi, loadBootstrap, loadPublicMeta } from './staticClient.js';
import type {
  ActualResultsState,
  ApiErrorBody,
  MasterGroupState,
  MasterTeamStats,
  MonteCarloResult,
  SetScoreResult,
  SimulateGroupResult,
  SimulateKnockoutsResult,
  SimulateMatchResult,
  Simulation,
  SimulationListEntry,
  Team,
  TournamentState,
} from '../types.js';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const privateApi = {
  listSimulations: () => request<SimulationListEntry[]>('/api/v1/simulations'),

  createSimulation: (name: string) =>
    request<Simulation>('/api/v1/simulations', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  renameSimulation: (id: number, name: string) =>
    request<Simulation>(`/api/v1/simulations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  deleteSimulation: (id: number) =>
    request<void>(`/api/v1/simulations/${id}`, { method: 'DELETE' }),

  activateSimulation: (id: number) =>
    request<Simulation>(`/api/v1/simulations/${id}/activate`, { method: 'POST' }),

  getState: (id: number) => request<TournamentState>(`/api/v1/simulations/${id}/state`),

  setMatchScore: (
    simulationId: number,
    matchNumber: number,
    goalsHome: number,
    goalsAway: number,
    winnerTeamId?: number | null,
  ) =>
    request<SetScoreResult>(`/api/v1/simulations/${simulationId}/matches/${matchNumber}`, {
      method: 'PUT',
      body: JSON.stringify({ goalsHome, goalsAway, winnerTeamId }),
    }),

  clearMatchScore: (simulationId: number, matchNumber: number) =>
    request<SetScoreResult>(
      `/api/v1/simulations/${simulationId}/matches/${matchNumber}`,
      { method: 'DELETE' },
    ),

  listTeams: () => request<Team[]>('/api/v1/teams'),

  updateTeamRatings: (teamId: number, offensiveRating: number, defensiveRating: number) =>
    request<Team>(`/api/v1/teams/${teamId}`, {
      method: 'PATCH',
      body: JSON.stringify({ offensiveRating, defensiveRating }),
    }),

  getActualResultsState: () => request<ActualResultsState>('/api/v1/actual-results/state'),

  getMasterGroupState: () => request<MasterGroupState>('/api/v1/master/group-state'),

  getMasterTeamStats: () => request<MasterTeamStats>('/api/v1/master/team-stats'),

  rebuildMasterTeamStats: () =>
    request<MasterTeamStats>('/api/v1/master/team-stats/rebuild', { method: 'POST' }),

  setActualResult: (
    matchNumber: number,
    goalsHome: number,
    goalsAway: number,
    winnerTeamId?: number | null,
  ) =>
    request(`/api/v1/actual-results/${matchNumber}`, {
      method: 'PUT',
      body: JSON.stringify({ goalsHome, goalsAway, winnerTeamId }),
    }),

  clearActualResult: (matchNumber: number) =>
    request<void>(`/api/v1/actual-results/${matchNumber}`, { method: 'DELETE' }),

  simulateGroupPhase: (simulationId: number, games?: 1 | 2 | 3) => {
    const qs = games != null ? `?games=${games}` : '';
    return request<SimulateGroupResult>(
      `/api/v1/simulations/${simulationId}/simulate/group${qs}`,
      { method: 'POST' },
    );
  },

  simulateKnockouts: (simulationId: number, throughRound?: string) => {
    const qs = throughRound != null ? `?through=${encodeURIComponent(throughRound)}` : '';
    return request<SimulateKnockoutsResult>(
      `/api/v1/simulations/${simulationId}/simulate/knockouts${qs}`,
      { method: 'POST' },
    );
  },

  simulateMatch: (simulationId: number, matchNumber: number) =>
    request<SimulateMatchResult>(
      `/api/v1/simulations/${simulationId}/matches/${matchNumber}/simulate`,
      { method: 'POST' },
    ),

  simulateMonteCarlo: async (
    count: number,
    upsetVariance: number,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<MonteCarloResult> => {
    const res = await fetch('/api/v1/simulate/monte-carlo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, upsetVariance, stream: true }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      throw new Error(body?.error ?? `Request failed (${res.status})`);
    }
    if (!res.body) {
      throw new Error('Bulk simulation returned no response body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: MonteCarloResult | null = null;

    const yieldFrame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

    const handleLine = async (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as {
        type: string;
        completed?: number;
        total?: number;
        result?: MonteCarloResult;
        message?: string;
      };
      if (event.type === 'progress' && event.completed != null && event.total != null) {
        onProgress?.(event.completed, event.total);
        await yieldFrame();
      } else if (event.type === 'result' && event.result) {
        result = event.result;
      } else if (event.type === 'error') {
        throw new Error(event.message ?? 'Bulk simulation failed');
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        await handleLine(line);
      }
    }
    if (buffer.trim()) {
      await handleLine(buffer);
    }
    if (!result) {
      throw new Error('Bulk simulation ended without a result');
    }
    return result;
  },
};

const publicApiStub = {
  listSimulations: async (): Promise<SimulationListEntry[]> => [],
  createSimulation: async (): Promise<Simulation> => {
    throw new Error('Not available in public mode');
  },
  renameSimulation: async (): Promise<Simulation> => {
    throw new Error('Not available in public mode');
  },
  deleteSimulation: async (): Promise<void> => {
    throw new Error('Not available in public mode');
  },
  activateSimulation: async (): Promise<Simulation> => {
    throw new Error('Not available in public mode');
  },
  getState: staticApi.getState,
  setMatchScore: async (): Promise<SetScoreResult> => {
    throw new Error('Use local simulation in public mode');
  },
  clearMatchScore: async (): Promise<SetScoreResult> => {
    throw new Error('Use local simulation in public mode');
  },
  listTeams: staticApi.listTeams,
  updateTeamRatings: async (): Promise<Team> => {
    throw new Error('Not available in public mode');
  },
  getActualResultsState: staticApi.getActualResultsState,
  getMasterGroupState: staticApi.getMasterGroupState,
  getMasterTeamStats: staticApi.getMasterTeamStats,
  rebuildMasterTeamStats: async (): Promise<MasterTeamStats> => {
    throw new Error('Not available in public mode');
  },
  setActualResult: async () => {
    throw new Error('Not available in public mode');
  },
  clearActualResult: async (): Promise<void> => {
    throw new Error('Not available in public mode');
  },
  simulateGroupPhase: async (): Promise<SimulateGroupResult> => {
    throw new Error('Not available in public mode');
  },
  simulateKnockouts: async (): Promise<SimulateKnockoutsResult> => {
    throw new Error('Not available in public mode');
  },
  simulateMatch: async (): Promise<SimulateMatchResult> => {
    throw new Error('Not available in public mode');
  },
  simulateMonteCarlo: async (): Promise<MonteCarloResult> => {
    throw new Error('Not available in public mode');
  },
};

export const api = isPublicMode() ? publicApiStub : privateApi;

let initialSimulationLoad: Promise<{ id: number; state: TournamentState }> | null = null;

export function loadInitialSimulation(): Promise<{ id: number; state: TournamentState }> {
  if (isPublicMode()) {
    return Promise.all([loadBootstrap(), loadPublicMeta()]).then(([bootstrap, meta]) => ({
      id: 0,
      state: hydrateLocalState(bootstrap, meta),
    }));
  }

  if (!initialSimulationLoad) {
    initialSimulationLoad = (async () => {
      const simulations = await api.listSimulations();
      if (simulations.length === 0) {
        throw new Error('No simulations available');
      }
      const active = simulations[0];
      await api.activateSimulation(active.id);
      const state = await api.getState(active.id);
      return { id: active.id, state };
    })();
  }
  return initialSimulationLoad;
}

export { isPublicMode } from '../config/appMode.js';
