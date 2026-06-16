import {
  DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT,
  TOURNAMENT_ELO_DELTA_WEIGHT_MAX,
} from '@shared/engine/tournamentElo.js';

export { DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT, TOURNAMENT_ELO_DELTA_WEIGHT_MAX };

const STORAGE_KEY = 'wc2026-tournament-elo-delta-weight';

export const TOURNAMENT_FORM_HINT =
  'Amplifies how much in-tournament Elo changes affect later match ratings. 0 ignores tournament results; higher values let early upsets shift who is favoured in later matches. Stored Elo deltas are unchanged.';

export function loadStoredTournamentEloDeltaWeight(): number {
  if (typeof window === 'undefined') return DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw == null) return DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > TOURNAMENT_ELO_DELTA_WEIGHT_MAX) {
    return DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT;
  }
  return value;
}

export function storeTournamentEloDeltaWeight(value: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, String(value));
}

export function formatTournamentEloDeltaWeight(value: number): string {
  return `β ${value.toFixed(2)}`;
}
