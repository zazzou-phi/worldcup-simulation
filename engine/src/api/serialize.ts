import type {
  TournamentState,
  Team,
  ResolvedMatch,
  SimulationMatch,
  ActualMatchResult,
  MasterGroupState,
  MasterKnockoutState,
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
    ...(state.sample != null ? { sample: state.sample } : {}),
    ...(state.sampleResults != null && Object.keys(state.sampleResults).length > 0
      ? {
          sampleResults: Object.fromEntries(
            Object.entries(state.sampleResults).map(([matchNumber, row]) => [
              matchNumber,
              row,
            ]),
          ),
        }
      : {}),
  };
}

export function serializeMasterKnockoutState(state: MasterKnockoutState) {
  return {
    consensusMode: state.consensusMode,
    resolvedMatches: state.resolvedMatches.map(serializeResolvedMatch),
    thirdPlaceOrder: state.thirdPlaceOrder.map((row) => ({
      groupLetter: row.groupLetter,
      position: row.position,
      teamId: row.teamId,
      team: serializeTeam(row.team),
      points: row.points,
      goalDifference: row.goalDifference,
      goalsFor: row.goalsFor,
      qualified: row.qualified,
    })),
    qualifyingThirdGroups: state.qualifyingThirdGroups,
    annexCCombinationId: state.annexCCombinationId,
    rounds: state.rounds,
    hasKnockoutResults: state.hasKnockoutResults,
    groupStageComplete: state.groupStageComplete,
    distributions: Object.fromEntries(
      Object.entries(state.distributions).map(([matchNumber, distribution]) => [
        matchNumber,
        distribution,
      ]),
    ),
    activeKnockoutSimulationId: state.activeKnockoutSimulationId,
    knockoutRuns: state.knockoutRuns,
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
    thirdPlaceOrder: state.thirdPlaceOrder.map((row) => ({
      groupLetter: row.groupLetter,
      position: row.position,
      teamId: row.teamId,
      team: serializeTeam(row.team),
      points: row.points,
      goalDifference: row.goalDifference,
      goalsFor: row.goalsFor,
      qualified: row.qualified,
    })),
    annexCCombinationId: state.annexCCombinationId,
    resolvedMatches: state.resolvedMatches.map(serializeResolvedMatch),
    actualResults: state.actualResults.map(serializeActualResult),
    eloDeltas: Object.fromEntries(
      [...state.eloDeltas.entries()].map(([teamId, delta]) => [String(teamId), delta]),
    ),
  };
}
