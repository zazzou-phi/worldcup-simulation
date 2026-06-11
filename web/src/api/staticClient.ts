import type {
  ActualResultsState,
  MasterGroupState,
  MasterTeamStats,
  PublicMeta,
  Team,
  TournamentState,
} from '../types.js';
import type { PublicBootstrap } from '@shared/export/publicSnapshot.js';

const DATA_BASE = `${import.meta.env.BASE_URL}data`;

async function loadJson<T>(filename: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${filename}`);
  if (!res.ok) {
    throw new Error(`Failed to load ${filename} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

let cachedBootstrap: PublicBootstrap | null = null;
let cachedMeta: PublicMeta | null = null;

export async function loadPublicMeta(): Promise<PublicMeta> {
  if (!cachedMeta) {
    cachedMeta = await loadJson<PublicMeta>('meta.json');
  }
  return cachedMeta;
}

export async function loadBootstrap(): Promise<PublicBootstrap> {
  if (!cachedBootstrap) {
    cachedBootstrap = await loadJson<PublicBootstrap>('bootstrap.json');
  }
  return cachedBootstrap;
}

export const staticApi = {
  getMasterGroupState: () => loadJson<MasterGroupState>('master-group-state.json'),

  getMasterTeamStats: () => loadJson<MasterTeamStats>('master-team-stats.json'),

  getActualResultsState: () => loadJson<ActualResultsState>('actual-results-state.json'),

  listTeams: async (): Promise<Team[]> => {
    const bootstrap = await loadBootstrap();
    return bootstrap.teams;
  },

  getState: async (_simulationId: number): Promise<TournamentState> => {
    throw new Error('Use local simulation state in public mode');
  },
};
