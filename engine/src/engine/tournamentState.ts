import {
  buildSlotContext,
  lookupAnnexC,
  resolveMatchTeams,
} from './bracket.js';
import { computePhase } from './phase.js';
import {
  collectPlayedGroupMatches,
  computeAllGroupStandings,
  getQualifyingThirdGroups,
  getQualifyingThirdGroupsKey,
} from './standings.js';
import type {
  ActualMatchResult,
  Fixture,
  GroupMembership,
  ResolvedMatch,
  Simulation,
  SimulationMatch,
  Team,
  TournamentState,
} from './types.js';

export interface SyncResolvedParticipantsResult {
  matches: SimulationMatch[];
  phase: Simulation['phase'];
  annexCCombinationId: number | null;
}

export function syncResolvedParticipantsInMemory(
  fixtures: Fixture[],
  matches: SimulationMatch[],
  teamsById: Map<number, Team>,
  memberships: GroupMembership[],
  actualResults: ActualMatchResult[],
): SyncResolvedParticipantsResult {
  const playedGroup = collectPlayedGroupMatches(fixtures, matches, actualResults);
  const groupStandings = computeAllGroupStandings(memberships, teamsById, playedGroup);
  const annex = lookupAnnexC(getQualifyingThirdGroupsKey(groupStandings));
  const annexId = annex?.id ?? null;
  const ctx = buildSlotContext(groupStandings, fixtures, matches, teamsById, annexId);
  const phase = computePhase(matches, fixtures);

  const updatedMatches = matches.map((match) => {
    const fixture = fixtures.find((f) => f.matchNumber === match.matchNumber);
    if (!fixture) return match;
    const { home, away } = resolveMatchTeams(fixture, ctx, teamsById);
    return {
      ...match,
      teamHomeId: home?.id ?? null,
      teamAwayId: away?.id ?? null,
    };
  });

  return {
    matches: updatedMatches,
    phase,
    annexCCombinationId: annexId,
  };
}

export interface BuildTournamentStateInput {
  simulation: Simulation;
  teams: Team[];
  fixtures: Fixture[];
  matches: SimulationMatch[];
  groupMemberships: GroupMembership[];
  actualResults: ActualMatchResult[];
  lockedMatchNumbers?: ReadonlySet<number>;
}

export function buildTournamentStateFromData(
  input: BuildTournamentStateInput,
): TournamentState {
  const teamsById = new Map(input.teams.map((t) => [t.id, t]));
  const locked = input.lockedMatchNumbers ?? new Set(
    input.actualResults.map((r) => r.matchNumber),
  );

  const synced = syncResolvedParticipantsInMemory(
    input.fixtures,
    input.matches,
    teamsById,
    input.groupMemberships,
    input.actualResults,
  );

  const simulation: Simulation = {
    ...input.simulation,
    phase: synced.phase,
    annexCCombinationId: synced.annexCCombinationId,
  };

  const matches = synced.matches;
  const playedGroup = collectPlayedGroupMatches(
    input.fixtures,
    matches,
    input.actualResults,
  );
  const groupStandings = computeAllGroupStandings(
    input.groupMemberships,
    teamsById,
    playedGroup,
  );
  const qualifyingThirdGroups = getQualifyingThirdGroups(groupStandings);

  const resolvedMatches: ResolvedMatch[] = input.fixtures.map((fixture) => {
    const result = matches.find((m) => m.matchNumber === fixture.matchNumber)!;
    const home =
      result.teamHomeId != null ? teamsById.get(result.teamHomeId) ?? null : null;
    const away =
      result.teamAwayId != null ? teamsById.get(result.teamAwayId) ?? null : null;
    return {
      fixture,
      result,
      homeTeam: home,
      awayTeam: away,
      homeLabel: home ? home.name : fixture.slotHome,
      awayLabel: away ? away.name : fixture.slotAway,
      isLocked: locked.has(fixture.matchNumber),
    };
  });

  return {
    simulation,
    teams: teamsById,
    fixtures: input.fixtures,
    matches,
    groupMemberships: input.groupMemberships,
    groupStandings,
    qualifyingThirdGroups,
    annexCCombinationId: synced.annexCCombinationId,
    resolvedMatches,
    actualResults: input.actualResults,
  };
}

export function createEmptyMatches(
  simulationId: number,
  fixtures: Fixture[],
): SimulationMatch[] {
  return fixtures.map((f) => ({
    simulationId,
    matchNumber: f.matchNumber,
    teamHomeId: f.teamHomeId,
    teamAwayId: f.teamAwayId,
    goalsHome: null,
    goalsAway: null,
    winnerTeamId: null,
    status: 'scheduled' as const,
  }));
}

export function applyActualResultsToMatches(
  matches: SimulationMatch[],
  actualResults: ActualMatchResult[],
): SimulationMatch[] {
  if (actualResults.length === 0) return matches;
  const actualByMatch = new Map(actualResults.map((r) => [r.matchNumber, r]));
  return matches.map((match) => {
    const actual = actualByMatch.get(match.matchNumber);
    if (!actual) return match;
    return {
      ...match,
      goalsHome: actual.goalsHome,
      goalsAway: actual.goalsAway,
      winnerTeamId: actual.winnerTeamId,
      status: 'played',
    };
  });
}
