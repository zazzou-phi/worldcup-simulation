import { chooseConsensus, type ConsensusMode } from '@shared/engine/consensus.js';
import { winnerFromGoals } from '@shared/engine/matchSimulator.js';
import {
  collectPlayedGroupMatches,
  computeAllGroupStandings,
  getQualifyingThirdGroups,
} from '@shared/engine/standings.js';
import type {
  ActualMatchResult,
  Fixture,
  GroupMembership,
  MasterGroupState,
  OutcomeDistribution,
  SimulationMatch,
} from '../types.js';

function distributionForMatch(
  distributions: Record<string, OutcomeDistribution>,
  matchNumber: number,
): OutcomeDistribution | undefined {
  return distributions[String(matchNumber)] ?? distributions[matchNumber as unknown as string];
}

export function applyConsensusMode(
  state: MasterGroupState,
  mode: ConsensusMode,
  fixtures: Fixture[],
  groupMemberships: GroupMembership[],
  actualResults: ActualMatchResult[] = [],
): MasterGroupState {
  const resolvedMatches = state.resolvedMatches.map((match) => {
    if (match.isLocked) return match;

    const dist = distributionForMatch(state.distributions, match.fixture.matchNumber);
    if (!dist || dist.total === 0 || !match.homeTeam || !match.awayTeam) {
      return {
        ...match,
        result: {
          ...match.result,
          goalsHome: null,
          goalsAway: null,
          winnerTeamId: null,
          status: 'scheduled' as const,
        },
      };
    }

    const scoreline = chooseConsensus({
      mode,
      outcomeCounts: dist,
      scorelines: dist.scorelines,
      homeOffensive: match.homeTeam.eloOffensiveRating,
      awayOffensive: match.awayTeam.eloOffensiveRating,
    });

    if (!scoreline) return match;

    const { goalsHome, goalsAway } = scoreline;
    return {
      ...match,
      result: {
        ...match.result,
        goalsHome,
        goalsAway,
        winnerTeamId: winnerFromGoals(
          goalsHome,
          goalsAway,
          match.fixture.teamHomeId!,
          match.fixture.teamAwayId!,
        ),
        status: 'played' as const,
      },
    };
  });

  const teamsById = new Map<number, NonNullable<(typeof resolvedMatches)[0]['homeTeam']>>();
  for (const match of resolvedMatches) {
    if (match.homeTeam) teamsById.set(match.homeTeam.id, match.homeTeam);
    if (match.awayTeam) teamsById.set(match.awayTeam.id, match.awayTeam);
  }

  const consensusMatches: SimulationMatch[] = resolvedMatches.map((match) => ({
    simulationId: 0,
    matchNumber: match.fixture.matchNumber,
    teamHomeId: match.fixture.teamHomeId,
    teamAwayId: match.fixture.teamAwayId,
    goalsHome: match.result.goalsHome,
    goalsAway: match.result.goalsAway,
    winnerTeamId: match.result.winnerTeamId,
    status: match.result.status,
  }));

  const playedGroup = collectPlayedGroupMatches(fixtures, consensusMatches, actualResults);
  const groupStandings = computeAllGroupStandings(groupMemberships, teamsById, playedGroup);
  const qualifyingThirdGroups = getQualifyingThirdGroups(groupStandings);

  return {
    ...state,
    consensusMode: mode,
    resolvedMatches,
    groupStandings,
    qualifyingThirdGroups,
  };
}
