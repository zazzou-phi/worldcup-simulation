import type {
  TournamentState,
  Team,
  ResolvedMatch,
  SimulationMatch,
  ActualMatchResult,
  MasterGroupState,
  MasterTeamStats,
} from '../engine/types.js';

export function serializeTeam(team: Team) {
  return { ...team };
}

export function serializeActualResult(result: ActualMatchResult) {
  return { ...result };
}

export function serializeMatch(match: SimulationMatch) {
  const { simulationId, ...rest } = match;
  return rest;
}

export function serializeResolvedMatch(resolved: ResolvedMatch) {
  return {
    fixture: resolved.fixture,
    result: serializeMatch(resolved.result),
    homeTeam: resolved.homeTeam ? serializeTeam(resolved.homeTeam) : null,
    awayTeam: resolved.awayTeam ? serializeTeam(resolved.awayTeam) : null,
    homeLabel: resolved.homeLabel,
    awayLabel: resolved.awayLabel,
    isLocked: resolved.isLocked,
  };
}

export function serializeMasterTeamStats(stats: MasterTeamStats) {
  return { ...stats };
}

export function serializeMasterGroupState(state: MasterGroupState) {
  return {
    consensusMode: state.consensusMode,
    resolvedMatches: state.resolvedMatches.map(serializeResolvedMatch),
    groupStandings: state.groupStandings,
    qualifyingThirdGroups: state.qualifyingThirdGroups,
    distributions: Object.fromEntries(
      Object.entries(state.distributions).map(([matchNumber, dist]) => [
        matchNumber,
        dist,
      ]),
    ),
  };
}

export function serializeTournamentState(state: TournamentState) {
  return {
    simulation: state.simulation,
    teams: Object.fromEntries(
      [...state.teams.entries()].map(([id, team]) => [String(id), serializeTeam(team)]),
    ),
    fixtures: state.fixtures,
    matches: state.matches.map(serializeMatch),
    groupMemberships: state.groupMemberships,
    groupStandings: state.groupStandings,
    qualifyingThirdGroups: state.qualifyingThirdGroups,
    annexCCombinationId: state.annexCCombinationId,
    resolvedMatches: state.resolvedMatches.map(serializeResolvedMatch),
    actualResults: state.actualResults.map(serializeActualResult),
    eloDeltas: Object.fromEntries(
      [...state.eloDeltas.entries()].map(([teamId, delta]) => [String(teamId), delta]),
    ),
  };
}
