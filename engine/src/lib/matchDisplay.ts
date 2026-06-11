import type { ResolvedMatch } from '../engine/types.js';
import { teamCode } from './teamCodes.js';

export function matchSideCode(match: ResolvedMatch, side: 'home' | 'away'): string {
  const team = side === 'home' ? match.homeTeam : match.awayTeam;
  const slot = side === 'home' ? match.fixture.slotHome : match.fixture.slotAway;
  return teamCode(team, slot);
}

export function matchTeamName(match: ResolvedMatch, side: 'home' | 'away'): string {
  const team = side === 'home' ? match.homeTeam : match.awayTeam;
  const slot = side === 'home' ? match.fixture.slotHome : match.fixture.slotAway;
  return team?.name ?? slot;
}

export function matchWinnerSide(match: ResolvedMatch): 'home' | 'away' | null {
  if (match.result.status !== 'played') return null;

  const goalsHome = match.result.goalsHome ?? 0;
  const goalsAway = match.result.goalsAway ?? 0;
  if (goalsHome > goalsAway) return match.homeTeam ? 'home' : null;
  if (goalsAway > goalsHome) return match.awayTeam ? 'away' : null;

  const winnerId = match.result.winnerTeamId;
  if (winnerId != null) {
    if (match.homeTeam?.id === winnerId) return 'home';
    if (match.awayTeam?.id === winnerId) return 'away';
  }
  return null;
}
