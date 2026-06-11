import {
  collectPlayedGroupMatches,
  computeAllGroupStandings,
  getQualifyingThirdGroups,
} from '@shared/engine/standings.js';
import type { GroupStandings, TournamentState } from '../types.js';

/** Recompute standings from fixtures + results (shared engine with the TUI). */
export function deriveGroupStandingsFromState(state: TournamentState): {
  groupStandings: GroupStandings[];
  qualifyingThirdGroups: string[];
} {
  const teamsById = new Map(Object.values(state.teams).map((t) => [t.id, t]));
  const playedGroup = collectPlayedGroupMatches(
    state.fixtures,
    state.matches,
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
