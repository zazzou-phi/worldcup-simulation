import { SIMULATION_KNOCKOUT_ROUNDS } from '@shared/engine/simulationRounds.js';
import type { MasterKnockoutState, TournamentState } from '../types.js';

/**
 * In public mode, knockout play happens on the local simulation state (and
 * localStorage) while master knockout is served from the static export. Overlay
 * local knockout scores onto the exported master view.
 */
export function applyLocalKnockoutToMasterState(
  tournamentState: TournamentState,
  masterKnockout: MasterKnockoutState,
): MasterKnockoutState {
  const locked = new Set(tournamentState.actualResults.map((result) => result.matchNumber));
  const localByMatch = new Map(
    tournamentState.matches
      .filter(
        (match) =>
          match.status === 'played' &&
          match.goalsHome != null &&
          match.goalsAway != null,
      )
      .map((match) => [match.matchNumber, match]),
  );

  const knockoutMatchNumbers = new Set(
    SIMULATION_KNOCKOUT_ROUNDS.flatMap((round) => round.matches),
  );

  let hasLocalKnockout = false;
  const resolvedMatches = masterKnockout.resolvedMatches.map((resolved) => {
    if (!knockoutMatchNumbers.has(resolved.fixture.matchNumber)) {
      return resolved;
    }

    const local = localByMatch.get(resolved.fixture.matchNumber);
    if (!local) return resolved;

    hasLocalKnockout = true;
    return {
      ...resolved,
      result: {
        ...resolved.result,
        teamHomeId: resolved.homeTeam?.id ?? resolved.result.teamHomeId,
        teamAwayId: resolved.awayTeam?.id ?? resolved.result.teamAwayId,
        goalsHome: local.goalsHome,
        goalsAway: local.goalsAway,
        penGoalsHome: local.penGoalsHome,
        penGoalsAway: local.penGoalsAway,
        winnerTeamId: local.winnerTeamId,
        status: 'played' as const,
      },
      isLocked: locked.has(resolved.fixture.matchNumber),
    };
  });

  const playedKnockout = new Set(
    resolvedMatches
      .filter(
        (match) =>
          match.fixture.group == null &&
          match.result.status === 'played' &&
          match.result.goalsHome != null &&
          match.result.goalsAway != null,
      )
      .map((match) => match.fixture.matchNumber),
  );

  const rounds = masterKnockout.rounds.map((round) => ({
    ...round,
    isComplete: round.matches.every((matchNumber) => playedKnockout.has(matchNumber)),
    canSimulate: false,
    disabledReason: round.isComplete ? 'Round already simulated' : round.disabledReason,
  }));

  return {
    ...masterKnockout,
    resolvedMatches,
    rounds,
    hasKnockoutResults: masterKnockout.hasKnockoutResults || hasLocalKnockout,
  };
}
