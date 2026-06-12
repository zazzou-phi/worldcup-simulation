import {
  isGroupFixtureWithinGamesTarget,
  type GroupGamesTarget,
} from './groupSimulation.js';
import {
  knockoutRoundTierIndex,
  SIMULATION_KNOCKOUT_ROUNDS,
} from './simulationRounds.js';
import type { Fixture, SimulationMatch } from './types.js';

export interface SimulateMenuAvailabilityInput {
  fixtures: ReadonlyArray<Pick<Fixture, 'matchNumber' | 'group' | 'round'>>;
  matches: ReadonlyArray<Pick<SimulationMatch, 'matchNumber' | 'status'>>;
}

function playedMatchNumbers(
  matches: ReadonlyArray<Pick<SimulationMatch, 'matchNumber' | 'status'>>,
): Set<number> {
  const played = new Set<number>();
  for (const match of matches) {
    if (match.status === 'played') {
      played.add(match.matchNumber);
    }
  }
  return played;
}

function isExclusiveToGroupRound(fixture: Pick<Fixture, 'group' | 'round'>, round: GroupGamesTarget): boolean {
  if (fixture.group == null) return false;
  if (round === 1) {
    return isGroupFixtureWithinGamesTarget(fixture as Fixture, 1);
  }
  const previous = (round - 1) as GroupGamesTarget;
  return (
    isGroupFixtureWithinGamesTarget(fixture as Fixture, round) &&
    !isGroupFixtureWithinGamesTarget(fixture as Fixture, previous)
  );
}

function furthestKnockoutRoundIndex(played: Set<number>): number {
  let furthest = -1;
  for (const round of SIMULATION_KNOCKOUT_ROUNDS) {
    if (round.matches.some((matchNumber) => played.has(matchNumber))) {
      furthest = Math.max(furthest, knockoutRoundTierIndex(round.name));
    }
  }
  return furthest;
}

function hasPlayedKnockoutMatch(played: Set<number>): boolean {
  return furthestKnockoutRoundIndex(played) >= 0;
}

function hasPlayedExclusiveGroupRound(
  fixtures: SimulateMenuAvailabilityInput['fixtures'],
  played: Set<number>,
  round: 2 | 3,
): boolean {
  return fixtures.some(
    (fixture) => isExclusiveToGroupRound(fixture, round) && played.has(fixture.matchNumber),
  );
}

function groupRoundFixtures(
  fixtures: SimulateMenuAvailabilityInput['fixtures'],
  round: GroupGamesTarget,
) {
  return fixtures.filter(
    (fixture) => fixture.group != null && isGroupFixtureWithinGamesTarget(fixture as Fixture, round),
  );
}

function isGroupRoundComplete(
  fixtures: SimulateMenuAvailabilityInput['fixtures'],
  played: Set<number>,
  round: GroupGamesTarget,
): boolean {
  const roundFixtures = groupRoundFixtures(fixtures, round);
  return roundFixtures.length > 0 && roundFixtures.every((fixture) => played.has(fixture.matchNumber));
}

function isKnockoutRoundComplete(played: Set<number>, roundIndex: number): boolean {
  const round = SIMULATION_KNOCKOUT_ROUNDS[roundIndex];
  if (!round) return false;
  return round.matches.every((matchNumber) => played.has(matchNumber));
}

function isGroupRoundMenuDisabled(
  fixtures: SimulateMenuAvailabilityInput['fixtures'],
  played: Set<number>,
  round: GroupGamesTarget,
): boolean {
  if (hasPlayedKnockoutMatch(played)) return true;
  if (isGroupRoundComplete(fixtures, played, round)) return true;
  if (round === 1) {
    return hasPlayedExclusiveGroupRound(fixtures, played, 2) || hasPlayedExclusiveGroupRound(fixtures, played, 3);
  }
  if (round === 2) {
    return hasPlayedExclusiveGroupRound(fixtures, played, 3);
  }
  return false;
}

export function isSimulateMenuItemDisabled(
  input: SimulateMenuAvailabilityInput,
  key: string,
): boolean {
  const played = playedMatchNumbers(input.matches);

  if (key.startsWith('group:')) {
    const round = parseInt(key.slice('group:'.length), 10);
    if (round !== 1 && round !== 2 && round !== 3) return false;
    return isGroupRoundMenuDisabled(input.fixtures, played, round);
  }

  const knockoutIndex = SIMULATION_KNOCKOUT_ROUNDS.findIndex((round) => round.name === key);
  if (knockoutIndex < 0) return false;

  const tierIndex = knockoutRoundTierIndex(key);
  return (
    furthestKnockoutRoundIndex(played) > tierIndex ||
    isKnockoutRoundComplete(played, knockoutIndex)
  );
}

export function getDisabledSimulateMenuKeys(
  input: SimulateMenuAvailabilityInput,
): ReadonlySet<string> {
  const disabled = new Set<string>();

  for (const round of [1, 2, 3] as const) {
    if (isGroupRoundMenuDisabled(input.fixtures, playedMatchNumbers(input.matches), round)) {
      disabled.add(`group:${round}`);
    }
  }

  for (const round of SIMULATION_KNOCKOUT_ROUNDS) {
    if (isSimulateMenuItemDisabled(input, round.name)) {
      disabled.add(round.name);
    }
  }

  return disabled;
}
