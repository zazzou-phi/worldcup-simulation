import { MAX_DOUBLE_DOWN } from './doubleDown.js';

const STORAGE_KEY = 'wc-fixed-double-downs';

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

export function loadStoredFixedDoubleDowns(predictionId: number): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    return new Set(parseMatchNumbers(localStorage.getItem(`${STORAGE_KEY}:${predictionId}`)));
  } catch {
    return new Set();
  }
}

export function storeFixedDoubleDowns(
  predictionId: number,
  matchNumbers: Iterable<number>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const values = [...matchNumbers].slice(0, MAX_DOUBLE_DOWN);
    localStorage.setItem(`${STORAGE_KEY}:${predictionId}`, JSON.stringify(values));
  } catch {
    /* ignore */
  }
}
