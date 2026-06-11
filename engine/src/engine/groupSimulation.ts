import type { Fixture } from './types.js';
import { parseMatchday } from './fixtureOrder.js';

/** Tournament matchday cutoffs when every team has played their x-th group game. */
export const GROUP_GAMES_MATCHDAY_CUTOFF = { 1: 7, 2: 13, 3: 17 } as const;

export type GroupGamesTarget = keyof typeof GROUP_GAMES_MATCHDAY_CUTOFF;

export function isGroupFixtureWithinGamesTarget(
  fixture: Fixture,
  target: GroupGamesTarget,
): boolean {
  const md = parseMatchday(fixture.round);
  if (md == null) return false;
  return md <= GROUP_GAMES_MATCHDAY_CUTOFF[target];
}
