import {
  collectPlayedGroupMatches,
  computeAllGroupStandings,
  getQualifyingThirdGroups,
} from '@shared/engine/standings.js';
import type {
  ActualMatchResult,
  Fixture,
  GroupStandings,
  MasterGroupState,
  SimulationMatch,
  Team,
  TournamentState,
} from '../types.js';

function groupMatchesFromResolved<T extends { fixture: { group: string | null }; result: SimulationMatch }>(
  resolvedMatches: T[],
): SimulationMatch[] {
  return resolvedMatches
    .filter((match) => match.fixture.group != null)
    .map((match) => ({
      matchNumber: match.fixture.matchNumber,
      teamHomeId: match.result.teamHomeId,
      teamAwayId: match.result.teamAwayId,
      goalsHome: match.result.goalsHome,
      goalsAway: match.result.goalsAway,
      winnerTeamId: match.result.winnerTeamId,
      status: match.result.status,
      simulationId: 0,
    }));
}

/** Group standings from locked actual results plus simulated results for the rest. */
export function deriveGroupStandingsFromState(state: TournamentState): {
  groupStandings: GroupStandings[];
  qualifyingThirdGroups: string[];
} {
  const teamsById = new Map(Object.values(state.teams).map((t) => [t.id, t]));
  const playedGroup = collectPlayedGroupMatches(
    state.fixtures,
    groupMatchesFromResolved(state.resolvedMatches),
    state.actualResults,
  );

  const groupStandings = computeAllGroupStandings(
    state.groupMemberships,
    teamsById,
    playedGroup,
  );
  return {
    groupStandings,
    qualifyingThirdGroups: getQualifyingThirdGroups(groupStandings),
  };
}

/** Group standings from locked actual results plus consensus for the rest. */
export function deriveMasterGroupStandings(
  masterState: MasterGroupState,
  fixtures: Fixture[],
  groupMemberships: Array<{ groupLetter: string; teamId: number }>,
  actualResults: ActualMatchResult[],
): {
  groupStandings: GroupStandings[];
  qualifyingThirdGroups: string[];
} {
  const teamsById = new Map<number, Team>();
  for (const match of masterState.resolvedMatches) {
    if (match.homeTeam) teamsById.set(match.homeTeam.id, match.homeTeam);
    if (match.awayTeam) teamsById.set(match.awayTeam.id, match.awayTeam);
  }

  const playedGroup = collectPlayedGroupMatches(
    fixtures,
    groupMatchesFromResolved(masterState.resolvedMatches),
    actualResults,
  );
  const groupStandings = computeAllGroupStandings(
    groupMemberships,
    teamsById,
    playedGroup,
  );
  return {
    groupStandings,
    qualifyingThirdGroups: getQualifyingThirdGroups(groupStandings),
  };
}
