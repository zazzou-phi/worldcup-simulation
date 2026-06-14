export const DEFAULT_RATING_ELO_WEIGHT = 0.65;

const STORAGE_KEY = 'wc2026-rating-elo-weight';

export function loadStoredRatingEloWeight(): number {
  if (typeof window === 'undefined') return DEFAULT_RATING_ELO_WEIGHT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw == null) return DEFAULT_RATING_ELO_WEIGHT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return DEFAULT_RATING_ELO_WEIGHT;
  return value;
}

export function storeRatingEloWeight(value: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, String(value));
}

export function formatRatingEloWeight(value: number): string {
  return `${Math.round(value * 100)}% Elo`;
}

export const RATING_ELO_WEIGHT_HINT =
  'Blend Elo and career goal rates. 0% is pure goals; 100% is pure Elo. Simulations use the blended ratings stored for each team.';
