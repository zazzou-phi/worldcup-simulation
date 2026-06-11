import { resolveWinnerTeamId } from '@shared/api/scoring.js';
import {
  applyActualResultsToMatches,
  buildTournamentStateFromData,
  createEmptyMatches,
} from '@shared/engine/tournamentState.js';
import type { PublicBootstrap } from '@shared/export/publicSnapshot.js';
import type { Simulation, SimulationMatch, TournamentState } from '../types.js';

const LOCAL_SIMULATION: Simulation = {
  id: 0,
  name: 'Your prediction',
  phase: 'group',
  annexCCombinationId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

export function createInitialLocalState(bootstrap: PublicBootstrap): TournamentState {
  const locked = new Set(bootstrap.actualResults.map((r) => r.matchNumber));
  let matches = createEmptyMatches(0, bootstrap.fixtures);
  matches = applyActualResultsToMatches(matches, bootstrap.actualResults);

  const raw = buildTournamentStateFromData({
    simulation: LOCAL_SIMULATION,
    teams: bootstrap.teams,
    fixtures: bootstrap.fixtures,
    matches,
    groupMemberships: bootstrap.groupMemberships,
    actualResults: bootstrap.actualResults,
    lockedMatchNumbers: locked,
  });

  return {
    ...raw,
    teams: Object.fromEntries([...raw.teams.entries()].map(([id, team]) => [String(id), team])),
    matches: raw.matches.map(({ simulationId: _sid, ...rest }) => rest),
  };
}

export class LocalSimulationError extends Error {}

function findResolvedMatch(state: TournamentState, matchNumber: number) {
  const resolved = state.resolvedMatches.find((m) => m.fixture.matchNumber === matchNumber);
  if (!resolved) {
    throw new LocalSimulationError('Match not found');
  }
  return resolved;
}

function toEngineMatches(state: TournamentState): SimulationMatch[] {
  return state.matches.map((m) => ({ ...m, simulationId: 0 }));
}

export function setLocalMatchScore(
  state: TournamentState,
  matchNumber: number,
  goalsHome: number,
  goalsAway: number,
  winnerTeamId?: number | null,
): TournamentState {
  const resolved = findResolvedMatch(state, matchNumber);
  if (resolved.isLocked) {
    throw new LocalSimulationError('Match is locked by an actual result');
  }

  const winner = resolveWinnerTeamId(resolved, goalsHome, goalsAway, winnerTeamId);
  const matches = toEngineMatches(state).map((match) =>
    match.matchNumber === matchNumber
      ? {
          ...match,
          goalsHome,
          goalsAway,
          winnerTeamId: winner,
          status: 'played' as const,
        }
      : match,
  );

  const locked = new Set(state.actualResults.map((r) => r.matchNumber));
  const raw = buildTournamentStateFromData({
    simulation: state.simulation,
    teams: Object.values(state.teams),
    fixtures: state.fixtures,
    matches,
    groupMemberships: state.groupMemberships,
    actualResults: state.actualResults,
    lockedMatchNumbers: locked,
  });

  return {
    ...raw,
    teams: Object.fromEntries([...raw.teams.entries()].map(([id, team]) => [String(id), team])),
    matches: raw.matches.map(({ simulationId: _sid, ...rest }) => rest),
  };
}

export function clearLocalMatchScore(
  state: TournamentState,
  matchNumber: number,
): TournamentState {
  const resolved = findResolvedMatch(state, matchNumber);
  if (resolved.isLocked) {
    throw new LocalSimulationError('Match is locked by an actual result');
  }

  const matches = toEngineMatches(state).map((match) =>
    match.matchNumber === matchNumber
      ? {
          ...match,
          goalsHome: null,
          goalsAway: null,
          winnerTeamId: null,
          status: 'scheduled' as const,
        }
      : match,
  );

  const locked = new Set(state.actualResults.map((r) => r.matchNumber));
  const raw = buildTournamentStateFromData({
    simulation: state.simulation,
    teams: Object.values(state.teams),
    fixtures: state.fixtures,
    matches,
    groupMemberships: state.groupMemberships,
    actualResults: state.actualResults,
    lockedMatchNumbers: locked,
  });

  return {
    ...raw,
    teams: Object.fromEntries([...raw.teams.entries()].map(([id, team]) => [String(id), team])),
    matches: raw.matches.map(({ simulationId: _sid, ...rest }) => rest),
  };
}
