import { compareFixturesChronologically } from './fixtureOrder.js';
import type { ResolvedMatch } from './types.js';

export function filterGroupMatchesByTeam(
  matches: ResolvedMatch[],
  teamId: number | null,
): ResolvedMatch[] {
  const filtered =
    teamId == null
      ? matches
      : matches.filter(
          (m) => m.homeTeam?.id === teamId || m.awayTeam?.id === teamId,
        );
  return sortResolvedMatchesChronologically(filtered);
}

export function sortResolvedMatchesChronologically(
  matches: ResolvedMatch[],
): ResolvedMatch[] {
  return [...matches].sort((a, b) =>
    compareFixturesChronologically(a.fixture, b.fixture),
  );
}
