import type { ActualMatchResult, Fixture, SimulationMatch } from './types.js';
import { GROUP_GAMES_MATCHDAY_CUTOFF } from './groupSimulation.js';
import {
  type GroupGamesTarget,
  isGroupFixtureWithinGamesTarget,
} from './groupSimulation.js';
import { parseMatchday } from './fixtureOrder.js';
import { FINAL_MATCH_NUMBER, SIMULATION_KNOCKOUT_ROUNDS } from './simulationRounds.js';

export type ActualResultRef = Pick<
  ActualMatchResult,
  'matchNumber' | 'goalsHome' | 'goalsAway' | 'winnerTeamId'
>;

/** Furthest simulation checkpoint reached (ordered from earliest to latest). */
export type Phase =
  | 'group'
  | 'g1'
  | 'g2'
  | 'g3'
  | 'round_of_32'
  | 'round_of_16'
  | 'quarter_final'
  | 'semi_final'
  | 'third_place'
  | 'complete';

export const SIMULATION_CHECKPOINTS: readonly Phase[] = [
  'group',
  'g1',
  'g2',
  'g3',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'complete',
] as const;

/** Phases where the group stage is still in progress (G3 not yet complete). */
export const GROUP_STAGE_PHASES: readonly Phase[] = ['group', 'g1', 'g2'] as const;

/** Phases where knockout simulation is available (group stage complete, final not yet played). */
export const KNOCKOUT_ELIGIBLE_PHASES: readonly Phase[] = [
  'g3',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
] as const;

export const PHASE_LABELS: Record<Phase, string> = {
  group: 'Group',
  g1: 'G1',
  g2: 'G2',
  g3: 'G3',
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-final',
  semi_final: 'Semi-final',
  third_place: 'Third place',
  complete: 'Complete',
};

export function isGroupStagePhase(phase: Phase): boolean {
  return (GROUP_STAGE_PHASES as readonly string[]).includes(phase);
}

export function isKnockoutStagePhase(phase: Phase): boolean {
  return !isGroupStagePhase(phase);
}

export function phaseLabel(phase: Phase): string {
  return PHASE_LABELS[phase];
}

function isGroupCheckpointComplete(
  target: GroupGamesTarget,
  matches: SimulationMatch[],
  fixtures: Fixture[],
): boolean {
  const groupFixtures = fixtures.filter(
    (f) => f.group != null && isGroupFixtureWithinGamesTarget(f, target),
  );
  return groupFixtures.every((f) => {
    const m = matches.find((r) => r.matchNumber === f.matchNumber);
    return m?.status === 'played';
  });
}

function isKnockoutRoundComplete(roundName: string, matches: SimulationMatch[]): boolean {
  const round = SIMULATION_KNOCKOUT_ROUNDS.find((r) => r.name === roundName);
  if (!round) return false;
  return round.matches.every((matchNumber) => {
    const m = matches.find((r) => r.matchNumber === matchNumber);
    return m?.status === 'played';
  });
}

export function isGroupStageComplete(matches: SimulationMatch[], fixtures: Fixture[]): boolean {
  return isGroupCheckpointComplete(3, matches, fixtures);
}

export function computePhase(matches: SimulationMatch[], fixtures: Fixture[]): Phase {
  let phase: Phase = 'group';

  if (isGroupCheckpointComplete(1, matches, fixtures)) phase = 'g1';
  if (isGroupCheckpointComplete(2, matches, fixtures)) phase = 'g2';
  if (isGroupCheckpointComplete(3, matches, fixtures)) phase = 'g3';

  for (const round of SIMULATION_KNOCKOUT_ROUNDS) {
    if (round.name === 'final') {
      const final = matches.find((m) => m.matchNumber === FINAL_MATCH_NUMBER);
      if (final?.status === 'played') return 'complete';
      continue;
    }
    if (isKnockoutRoundComplete(round.name, matches)) {
      phase = round.name as Phase;
    }
  }

  return phase;
}

/** Phase bucket a fixture's actual result belongs to (matches simulation.phase checkpoints). */
export function getFixtureResultPhase(fixture: Fixture): Phase | null {
  if (fixture.group != null) {
    const md = parseMatchday(fixture.round);
    if (md == null) return null;
    if (md <= GROUP_GAMES_MATCHDAY_CUTOFF[1]) return 'group';
    if (md <= GROUP_GAMES_MATCHDAY_CUTOFF[2]) return 'g1';
    if (md <= GROUP_GAMES_MATCHDAY_CUTOFF[3]) return 'g2';
    return null;
  }

  const entryPhaseByRound: Record<string, Phase> = {
    round_of_32: 'g3',
    round_of_16: 'round_of_32',
    quarter_final: 'round_of_16',
    semi_final: 'quarter_final',
    third_place: 'semi_final',
    final: 'semi_final',
  };

  for (const round of SIMULATION_KNOCKOUT_ROUNDS) {
    if (round.matches.includes(fixture.matchNumber)) {
      return entryPhaseByRound[round.name] ?? null;
    }
  }

  return null;
}

export function phaseIndex(phase: Phase): number {
  return SIMULATION_CHECKPOINTS.indexOf(phase);
}

export function matchesFromActualResults(
  fixtures: Fixture[],
  actualResults: ActualResultRef[],
): SimulationMatch[] {
  const actualByMatch = new Map(actualResults.map((r) => [r.matchNumber, r]));
  return fixtures.map((fixture) => {
    const actual = actualByMatch.get(fixture.matchNumber);
    return {
      simulationId: 0,
      matchNumber: fixture.matchNumber,
      teamHomeId: fixture.teamHomeId,
      teamAwayId: fixture.teamAwayId,
      goalsHome: actual?.goalsHome ?? null,
      goalsAway: actual?.goalsAway ?? null,
      winnerTeamId: actual?.winnerTeamId ?? null,
      status: actual ? 'played' : 'scheduled',
    };
  });
}

/** Furthest tournament round reached by recorded actual results. */
export function computeActualPhase(actualResults: ActualResultRef[], fixtures: Fixture[]): Phase {
  return computePhase(matchesFromActualResults(fixtures, actualResults), fixtures);
}

/** True when no played results exist in later tournament rounds than the match's round. */
export function canModifyResultInPhaseOrder(
  matchNumber: number,
  playedMatchNumbers: ReadonlySet<number>,
  fixtures: Fixture[],
): boolean {
  const fixture = fixtures.find((f) => f.matchNumber === matchNumber);
  if (!fixture) return false;

  const matchPhase = getFixtureResultPhase(fixture);
  if (matchPhase == null) return false;

  const matchPhaseIdx = phaseIndex(matchPhase);
  for (const otherMatchNumber of playedMatchNumbers) {
    if (otherMatchNumber === matchNumber) continue;
    const other = fixtures.find((f) => f.matchNumber === otherMatchNumber);
    if (!other) continue;
    const otherPhase = getFixtureResultPhase(other);
    if (otherPhase != null && phaseIndex(otherPhase) > matchPhaseIdx) {
      return false;
    }
  }
  return true;
}

/** True when an existing actual result may be changed or removed. */
export function canModifyActualResult(
  matchNumber: number,
  actualResults: ActualResultRef[],
  fixtures: Fixture[],
): boolean {
  if (!actualResults.some((result) => result.matchNumber === matchNumber)) return true;
  return canModifyResultInPhaseOrder(
    matchNumber,
    new Set(actualResults.map((r) => r.matchNumber)),
    fixtures,
  );
}

function simulationPlayedMatchNumbers(
  matches: ReadonlyArray<Pick<SimulationMatch, 'matchNumber' | 'status'>>,
  lockedMatchNumbers: ReadonlySet<number> = new Set(),
): Set<number> {
  return new Set(
    matches
      .filter(
        (match) => match.status === 'played' && !lockedMatchNumbers.has(match.matchNumber),
      )
      .map((match) => match.matchNumber),
  );
}

/** True when an existing simulation result may be changed or removed. */
export function canModifySimulationResult(
  matchNumber: number,
  matches: ReadonlyArray<Pick<SimulationMatch, 'matchNumber' | 'status'>>,
  fixtures: Fixture[],
  lockedMatchNumbers: ReadonlySet<number> = new Set(),
): boolean {
  const match = matches.find((row) => row.matchNumber === matchNumber);
  const hasSimulationResult =
    match?.status === 'played' && !lockedMatchNumbers.has(matchNumber);
  if (!hasSimulationResult) return true;

  return canModifyResultInPhaseOrder(
    matchNumber,
    simulationPlayedMatchNumbers(matches, lockedMatchNumbers),
    fixtures,
  );
}

/** True when no actual results exist in later tournament rounds than the match's round. */
export function canClearActualResult(
  matchNumber: number,
  actualResults: ActualResultRef[],
  fixtures: Fixture[],
): boolean {
  if (!actualResults.some((r) => r.matchNumber === matchNumber)) return false;
  return canModifyActualResult(matchNumber, actualResults, fixtures);
}

/** True when no simulation results exist in later tournament rounds than the match's round. */
export function canClearSimulationResult(
  matchNumber: number,
  matches: ReadonlyArray<Pick<SimulationMatch, 'matchNumber' | 'status'>>,
  fixtures: Fixture[],
  lockedMatchNumbers: ReadonlySet<number> = new Set(),
): boolean {
  const match = matches.find((row) => row.matchNumber === matchNumber);
  if (!match || match.status !== 'played' || lockedMatchNumbers.has(matchNumber)) return false;
  return canModifySimulationResult(matchNumber, matches, fixtures, lockedMatchNumbers);
}
