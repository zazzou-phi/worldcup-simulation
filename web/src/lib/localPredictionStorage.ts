import { compareFixturesChronologically } from '@shared/engine/fixtureOrder.js';
import type { PublicBootstrap } from '@shared/export/publicSnapshot.js';
import {
  createInitialLocalState,
  setLocalMatchScore,
} from './localSimulation.js';
import type { ActualMatchResult, PublicMeta, TournamentState } from '../types.js';

const STORAGE_KEY = 'wc-simulation:prediction';
const SCHEMA_VERSION = 1;

interface StoredMatchRow {
  matchNumber: number;
  goalsHome: number;
  goalsAway: number;
  winnerTeamId: number | null;
}

interface StoredPrediction {
  schemaVersion: number;
  snapshotId: string;
  matches: StoredMatchRow[];
}

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function computeSnapshotId(
  meta: PublicMeta,
  actualResults: ActualMatchResult[],
): string {
  const resultsKey = [...actualResults]
    .sort((a, b) => a.matchNumber - b.matchNumber)
    .map((r) => `${r.matchNumber}:${r.goalsHome}-${r.goalsAway}`)
    .join(';');
  return `${meta.exportedAt}|${resultsKey}`;
}

function readStoredPrediction(): StoredPrediction | null {
  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPrediction;
    if (parsed.schemaVersion !== SCHEMA_VERSION || typeof parsed.snapshotId !== 'string') {
      return null;
    }
    if (!Array.isArray(parsed.matches)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredPrediction(): void {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function extractPredictions(state: TournamentState): StoredMatchRow[] {
  const locked = new Set(state.actualResults.map((r) => r.matchNumber));
  return state.matches
    .filter(
      (match) =>
        match.status === 'played' &&
        !locked.has(match.matchNumber) &&
        match.goalsHome != null &&
        match.goalsAway != null,
    )
    .map((match) => ({
      matchNumber: match.matchNumber,
      goalsHome: match.goalsHome!,
      goalsAway: match.goalsAway!,
      winnerTeamId: match.winnerTeamId,
    }));
}

function applyStoredMatches(
  state: TournamentState,
  saved: StoredMatchRow[],
): TournamentState {
  const locked = new Set(state.actualResults.map((r) => r.matchNumber));
  const savedByNumber = new Map(saved.map((row) => [row.matchNumber, row]));

  const matchNumbers = [...savedByNumber.keys()]
    .filter((matchNumber) => !locked.has(matchNumber))
    .sort((a, b) => {
      const fixtureA = state.fixtures.find((f) => f.matchNumber === a);
      const fixtureB = state.fixtures.find((f) => f.matchNumber === b);
      if (!fixtureA || !fixtureB) return a - b;
      return compareFixturesChronologically(fixtureA, fixtureB);
    });

  let current = state;
  for (const matchNumber of matchNumbers) {
    const row = savedByNumber.get(matchNumber)!;
    try {
      current = setLocalMatchScore(
        current,
        matchNumber,
        row.goalsHome,
        row.goalsAway,
        row.winnerTeamId,
      );
    } catch {
      continue;
    }
  }
  return current;
}

export function hydrateLocalState(
  bootstrap: PublicBootstrap,
  meta: PublicMeta,
): TournamentState {
  const initial = createInitialLocalState(bootstrap);
  const stored = readStoredPrediction();
  const snapshotId = computeSnapshotId(meta, bootstrap.actualResults);

  if (!stored || stored.snapshotId !== snapshotId) {
    if (stored) clearStoredPrediction();
    return initial;
  }

  if (stored.matches.length === 0) {
    return initial;
  }

  return applyStoredMatches(initial, stored.matches);
}

export function persistLocalPrediction(state: TournamentState, meta: PublicMeta): void {
  if (!storageAvailable()) return;

  const matches = extractPredictions(state);
  if (matches.length === 0) {
    clearStoredPrediction();
    return;
  }

  const payload: StoredPrediction = {
    schemaVersion: SCHEMA_VERSION,
    snapshotId: computeSnapshotId(meta, state.actualResults),
    matches,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // quota exceeded or storage disabled
  }
}
