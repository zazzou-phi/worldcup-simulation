import { MAX_DOUBLE_DOWN } from './doubleDown.js';

const SHARED_STORAGE_KEY = 'wc-fixed-double-downs';
const LEGACY_STORAGE_PREFIX = 'wc-fixed-double-downs:';

function parseMatchNumbers(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is number => typeof value === 'number' && Number.isInteger(value))
      .slice(0, MAX_DOUBLE_DOWN);
  } catch {
    return [];
  }
}

/** Copy per-prediction legacy picks into the shared store when it is still empty. */
export function inheritFixedDoubleDowns(fromPredictionId: number | null): void {
  if (typeof window === 'undefined' || fromPredictionId == null) return;
  try {
    if (parseMatchNumbers(localStorage.getItem(SHARED_STORAGE_KEY)).length > 0) return;
    const legacy = parseMatchNumbers(
      localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${fromPredictionId}`),
    );
    if (legacy.length === 0) return;
    localStorage.setItem(SHARED_STORAGE_KEY, JSON.stringify(legacy));
  } catch {
    /* ignore */
  }
}

export function loadStoredFixedDoubleDowns(predictionId: number): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const shared = parseMatchNumbers(localStorage.getItem(SHARED_STORAGE_KEY));
    if (shared.length > 0) return new Set(shared);
    return new Set(
      parseMatchNumbers(localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${predictionId}`)),
    );
  } catch {
    return new Set();
  }
}

export function storeFixedDoubleDowns(
  _predictionId: number,
  matchNumbers: Iterable<number>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const values = [...matchNumbers].slice(0, MAX_DOUBLE_DOWN);
    localStorage.setItem(SHARED_STORAGE_KEY, JSON.stringify(values));
  } catch {
    /* ignore */
  }
}
