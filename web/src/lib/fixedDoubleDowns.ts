import { KNOCKOUT_R32_DOUBLE_DOWN_COUNT, MAX_DOUBLE_DOWN } from './doubleDown.js';

const SHARED_STORAGE_KEY = 'wc-fixed-double-downs';
const LEGACY_STORAGE_PREFIX = 'wc-fixed-double-downs:';
const KNOCKOUT_R32_STORAGE_KEY = 'wc-knockout-r32-fixed-double-downs';
const KNOCKOUT_R32_LEGACY_PREFIX = 'wc-knockout-r32-fixed-double-downs:';

function parseMatchNumbers(raw: string | null, max = MAX_DOUBLE_DOWN): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is number => typeof value === 'number' && Number.isInteger(value))
      .slice(0, max);
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

export function inheritKnockoutR32FixedDoubleDowns(fromPredictionId: number | null): void {
  if (typeof window === 'undefined' || fromPredictionId == null) return;
  try {
    if (parseMatchNumbers(localStorage.getItem(KNOCKOUT_R32_STORAGE_KEY), KNOCKOUT_R32_DOUBLE_DOWN_COUNT).length > 0) {
      return;
    }
    const legacy = parseMatchNumbers(
      localStorage.getItem(`${KNOCKOUT_R32_LEGACY_PREFIX}${fromPredictionId}`),
      KNOCKOUT_R32_DOUBLE_DOWN_COUNT,
    );
    if (legacy.length === 0) return;
    localStorage.setItem(KNOCKOUT_R32_STORAGE_KEY, JSON.stringify(legacy));
  } catch {
    /* ignore */
  }
}

export function loadStoredKnockoutR32FixedDoubleDowns(predictionId: number): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const shared = parseMatchNumbers(
      localStorage.getItem(KNOCKOUT_R32_STORAGE_KEY),
      KNOCKOUT_R32_DOUBLE_DOWN_COUNT,
    );
    if (shared.length > 0) return new Set(shared);
    return new Set(
      parseMatchNumbers(
        localStorage.getItem(`${KNOCKOUT_R32_LEGACY_PREFIX}${predictionId}`),
        KNOCKOUT_R32_DOUBLE_DOWN_COUNT,
      ),
    );
  } catch {
    return new Set();
  }
}

export function storeKnockoutR32FixedDoubleDowns(
  _predictionId: number,
  matchNumbers: Iterable<number>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const values = [...matchNumbers].slice(0, KNOCKOUT_R32_DOUBLE_DOWN_COUNT);
    localStorage.setItem(KNOCKOUT_R32_STORAGE_KEY, JSON.stringify(values));
  } catch {
    /* ignore */
  }
}
