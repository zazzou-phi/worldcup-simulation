import {
  chooseConsensus,
  type ConsensusMode,
  type OutcomeCounts,
  type ScorelineCount,
} from './consensus.js';
import {
  buildWinnersLosers,
  lookupAnnexC,
  resolveMatchTeams,
  type SlotContext,
} from './bracket.js';
import {
  simulateMatchOutcome,
  winnerFromGoals,
  type MatchResultRow,
  type RandomSource,
  DEFAULT_UPSET_VARIANCE,
} from './matchSimulator.js';
import { simulatePenaltyShootout, teamPenaltyRate } from './penaltyShootout.js';
import { teamForSimulation } from './teamRatings.js';
import {
  computeEloDeltasFromMatches,
  computeSimulationRatings,
  type EloMatchInput,
  type SimulationRatings,
} from './tournamentElo.js';
import { compareFixturesChronologically } from './fixtureOrder.js';
import {
  knockoutRoundTierIndex,
  SIMULATION_KNOCKOUT_ROUNDS,
} from './simulationRounds.js';
import { rankThirdPlaceTeams } from './standings.js';
import type { Fixture, GroupStandings, SimulationMatch, Team, ThirdPlaceOrderRow } from './types.js';

export type SimulatedPredictionKnockoutMatch = MatchResultRow & {
  distribution: KnockoutMatchDistribution;
};

export const PREDICTION_KNOCKOUT_MC_COUNT = 10_000;

export interface PredictionKnockoutResult {
  matchNumber: number;
  goalsHome: number;
  goalsAway: number;
  winnerTeamId: number;
  penGoalsHome: number | null;
  penGoalsAway: number | null;
  distribution?: KnockoutMatchDistribution;
}

export interface KnockoutMatchDistribution {
  homeWin: number;
  draw: number;
  awayWin: number;
  total: number;
  scorelines: ScorelineCount[];
}

export interface ThirdPlaceOrderEntry {
  groupLetter: string;
  position: number;
}

export interface KnockoutRoundAvailability {
  name: string;
  label: string;
  matches: readonly number[];
  canSimulate: boolean;
  isComplete: boolean;
  disabledReason?: string;
}

const ROUND_LABELS: Record<string, string> = {
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-final',
  semi_final: 'Semi-final',
  third_place: 'Third place',
  final: 'Final',
};

export function getQualifyingThirdGroupsFromOrder(order: ThirdPlaceOrderEntry[]): string[] {
  return [...order]
    .sort((a, b) => a.position - b.position)
    .slice(0, 8)
    .map((entry) => entry.groupLetter)
    .sort();
}

export function defaultThirdPlaceOrder(standings: GroupStandings[]): ThirdPlaceOrderEntry[] {
  return rankThirdPlaceTeams(standings).map((row, index) => ({
    groupLetter: row.groupLetter,
    position: index + 1,
  }));
}

export function buildThirdPlaceOrderRows(
  standings: GroupStandings[],
  entries: ThirdPlaceOrderEntry[],
): ThirdPlaceOrderRow[] {
  return [...entries]
    .sort((a, b) => a.position - b.position)
    .map((entry) => {
      const group = standings.find((standing) => standing.groupLetter === entry.groupLetter);
      const row = group?.rows[2];
      if (!row) {
        throw new Error(`Missing third-place row for group ${entry.groupLetter}`);
      }
      return {
        groupLetter: entry.groupLetter,
        position: entry.position,
        teamId: row.teamId,
        team: row.team,
        points: row.points,
        goalDifference: row.goalDifference,
        goalsFor: row.goalsFor,
        qualified: entry.position <= 8,
      };
    });
}

export function knockoutResultsToSimulationMatches(
  results: PredictionKnockoutResult[],
): SimulationMatch[] {
  return results.map((result) => ({
    simulationId: 0,
    matchNumber: result.matchNumber,
    teamHomeId: null,
    teamAwayId: null,
    goalsHome: result.goalsHome,
    goalsAway: result.goalsAway,
    penGoalsHome: result.penGoalsHome,
    penGoalsAway: result.penGoalsAway,
    winnerTeamId: result.winnerTeamId,
    status: 'played' as const,
  }));
}

export function buildPredictionSlotContext(
  standings: GroupStandings[],
  thirdPlaceOrder: ThirdPlaceOrderEntry[],
  fixtures: Fixture[],
  knockoutResults: PredictionKnockoutResult[],
  teamsById: Map<number, Team>,
): { ctx: SlotContext; annexCCombinationId: number | null } {
  const qualifyingThirdGroups = getQualifyingThirdGroupsFromOrder(thirdPlaceOrder);
  const annex = lookupAnnexC(qualifyingThirdGroups.join(''));
  const annexThirdByMatch = annex?.thirdByMatch ?? {};

  const partial: Omit<SlotContext, 'winnersByMatch' | 'losersByMatch'> = {
    standings,
    qualifyingThirdGroups,
    annexThirdByMatch: Object.fromEntries(
      Object.entries(annexThirdByMatch).map(([k, v]) => [k, v]),
    ),
  };

  const matches = knockoutResultsToSimulationMatches(knockoutResults);
  const { winnersByMatch, losersByMatch } = buildWinnersLosers(
    fixtures,
    matches,
    teamsById,
    partial,
  );

  return {
    ctx: { ...partial, winnersByMatch, losersByMatch },
    annexCCombinationId: annex?.id ?? null,
  };
}

function playedKnockoutMatchNumbers(results: PredictionKnockoutResult[]): Set<number> {
  return new Set(results.map((result) => result.matchNumber));
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

function isKnockoutRoundComplete(played: Set<number>, roundIndex: number): boolean {
  const round = SIMULATION_KNOCKOUT_ROUNDS[roundIndex];
  if (!round) return false;
  return round.matches.every((matchNumber) => played.has(matchNumber));
}

function allTeamsResolved(
  matchNumbers: readonly number[],
  fixtures: Fixture[],
  ctx: SlotContext,
  teamsById: Map<number, Team>,
): boolean {
  for (const matchNumber of matchNumbers) {
    const fixture = fixtures.find((f) => f.matchNumber === matchNumber);
    if (!fixture) return false;
    const { home, away } = resolveMatchTeams(fixture, ctx, teamsById);
    if (!home || !away) return false;
  }
  return true;
}

export function collectPredictionKnockoutEloMatches(
  fixtures: Fixture[],
  ctx: SlotContext,
  teamsById: Map<number, Team>,
  groupResolvedMatches: Array<{ fixture: Fixture; result: SimulationMatch }>,
  knockoutResults: PredictionKnockoutResult[],
): EloMatchInput[] {
  const entries: Array<{ fixture: Fixture; match: EloMatchInput }> = [];

  for (const { fixture, result } of groupResolvedMatches) {
    if (
      result.status !== 'played' ||
      result.teamHomeId == null ||
      result.teamAwayId == null ||
      result.goalsHome == null ||
      result.goalsAway == null
    ) {
      continue;
    }
    entries.push({
      fixture,
      match: {
        matchNumber: fixture.matchNumber,
        teamHomeId: result.teamHomeId,
        teamAwayId: result.teamAwayId,
        goalsHome: result.goalsHome,
        goalsAway: result.goalsAway,
      },
    });
  }

  for (const result of knockoutResults) {
    const fixture = fixtures.find((entry) => entry.matchNumber === result.matchNumber);
    if (!fixture) continue;
    const { home, away } = resolveMatchTeams(fixture, ctx, teamsById);
    if (!home || !away) continue;
    entries.push({
      fixture,
      match: {
        matchNumber: result.matchNumber,
        teamHomeId: home.id,
        teamAwayId: away.id,
        goalsHome: result.goalsHome,
        goalsAway: result.goalsAway,
      },
    });
  }

  return entries
    .sort((a, b) => compareFixturesChronologically(a.fixture, b.fixture))
    .map(({ match }) => match);
}

export function buildPredictionKnockoutRatings(
  teams: Team[],
  fixtures: Fixture[],
  ctx: SlotContext,
  teamsById: Map<number, Team>,
  groupResolvedMatches: Array<{ fixture: Fixture; result: SimulationMatch }>,
  knockoutResults: PredictionKnockoutResult[],
  eloWeight: number,
  deltaWeight: number,
): Map<number, SimulationRatings> {
  const eloMatches = collectPredictionKnockoutEloMatches(
    fixtures,
    ctx,
    teamsById,
    groupResolvedMatches,
    knockoutResults,
  );
  const deltas = computeEloDeltasFromMatches(teams, eloMatches);
  return computeSimulationRatings(teams, deltas, eloWeight, deltaWeight);
}

export function ratedTeam(
  team: Team,
  ratingsByTeamId?: Map<number, SimulationRatings>,
): Team {
  const ratings = ratingsByTeamId?.get(team.id);
  return ratings ? teamForSimulation(team, ratings) : team;
}

export function findKnockoutRoundNameForMatch(matchNumber: number): string | null {
  const round = SIMULATION_KNOCKOUT_ROUNDS.find((entry) =>
    (entry.matches as readonly number[]).includes(matchNumber),
  );
  return round?.name ?? null;
}

export function knockoutMatchNumbersFromRoundOnward(roundName: string): number[] {
  const roundIndex = SIMULATION_KNOCKOUT_ROUNDS.findIndex((round) => round.name === roundName);
  if (roundIndex < 0) {
    throw new RangeError(`Unknown knockout round: ${roundName}`);
  }
  const matchNumbers: number[] = [];
  for (let index = roundIndex; index < SIMULATION_KNOCKOUT_ROUNDS.length; index += 1) {
    matchNumbers.push(...SIMULATION_KNOCKOUT_ROUNDS[index]!.matches);
  }
  return matchNumbers;
}

export function knockoutMatchNumbersAfterRound(roundName: string): number[] {
  const roundIndex = SIMULATION_KNOCKOUT_ROUNDS.findIndex((round) => round.name === roundName);
  if (roundIndex < 0) {
    throw new RangeError(`Unknown knockout round: ${roundName}`);
  }
  const matchNumbers: number[] = [];
  for (let index = roundIndex + 1; index < SIMULATION_KNOCKOUT_ROUNDS.length; index += 1) {
    matchNumbers.push(...SIMULATION_KNOCKOUT_ROUNDS[index]!.matches);
  }
  return matchNumbers;
}

export function canResimulateKnockoutMatch(
  matchNumber: number,
  fixtures: Fixture[],
  ctx: SlotContext,
  teamsById: Map<number, Team>,
  knockoutResults: PredictionKnockoutResult[],
  groupStageComplete: boolean,
  isLocked: (matchNumber: number) => boolean,
): { allowed: boolean; disabledReason?: string; clearsLaterRounds: boolean } {
  if (isLocked(matchNumber)) {
    return { allowed: false, disabledReason: 'Actual result is locked', clearsLaterRounds: false };
  }

  if (!groupStageComplete) {
    return { allowed: false, disabledReason: 'Complete the group stage first', clearsLaterRounds: false };
  }

  const hasResult = knockoutResults.some((result) => result.matchNumber === matchNumber);
  if (!hasResult) {
    return { allowed: false, disabledReason: 'Match has not been simulated yet', clearsLaterRounds: false };
  }

  const roundName = findKnockoutRoundNameForMatch(matchNumber);
  if (!roundName) {
    return { allowed: false, disabledReason: 'Not a knockout match', clearsLaterRounds: false };
  }

  const fixture = fixtures.find((entry) => entry.matchNumber === matchNumber);
  if (!fixture) {
    return { allowed: false, disabledReason: 'Unknown match', clearsLaterRounds: false };
  }

  const { home, away } = resolveMatchTeams(fixture, ctx, teamsById);
  if (!home || !away) {
    return { allowed: false, disabledReason: 'Teams not yet resolved for this match', clearsLaterRounds: false };
  }

  const played = playedKnockoutMatchNumbers(knockoutResults);
  const laterMatches = knockoutMatchNumbersAfterRound(roundName);
  const clearsLaterRounds = laterMatches.some((laterMatchNumber) => played.has(laterMatchNumber));

  return { allowed: true, clearsLaterRounds };
}

export function canResimulateKnockoutRound(
  fixtures: Fixture[],
  ctx: SlotContext,
  teamsById: Map<number, Team>,
  knockoutResults: PredictionKnockoutResult[],
  groupStageComplete: boolean,
  roundName: string,
): { allowed: boolean; disabledReason?: string; clearsLaterRounds: boolean } {
  const roundIndex = SIMULATION_KNOCKOUT_ROUNDS.findIndex((round) => round.name === roundName);
  if (roundIndex < 0) {
    return { allowed: false, disabledReason: 'Unknown round', clearsLaterRounds: false };
  }

  const played = playedKnockoutMatchNumbers(knockoutResults);
  const round = SIMULATION_KNOCKOUT_ROUNDS[roundIndex]!;
  const isComplete = isKnockoutRoundComplete(played, roundIndex);
  if (!isComplete) {
    return { allowed: false, disabledReason: 'Round has not been simulated yet', clearsLaterRounds: false };
  }

  if (!groupStageComplete) {
    return { allowed: false, disabledReason: 'Complete the group stage first', clearsLaterRounds: false };
  }

  if (roundIndex > 0) {
    const previousRound = SIMULATION_KNOCKOUT_ROUNDS[roundIndex - 1]!;
    if (!isKnockoutRoundComplete(played, roundIndex - 1)) {
      return {
        allowed: false,
        disabledReason: `Simulate ${ROUND_LABELS[previousRound.name] ?? previousRound.name} first`,
        clearsLaterRounds: false,
      };
    }
  }

  if (!allTeamsResolved(round.matches, fixtures, ctx, teamsById)) {
    return { allowed: false, disabledReason: 'Teams not yet resolved for this round', clearsLaterRounds: false };
  }

  const laterMatchNumbers = new Set(
    knockoutMatchNumbersFromRoundOnward(roundName).filter(
      (matchNumber) => !round.matches.includes(matchNumber),
    ),
  );
  const clearsLaterRounds = [...played].some((matchNumber) => laterMatchNumbers.has(matchNumber));

  return { allowed: true, clearsLaterRounds };
}

export function computeKnockoutRoundAvailability(
  fixtures: Fixture[],
  ctx: SlotContext,
  teamsById: Map<number, Team>,
  knockoutResults: PredictionKnockoutResult[],
  groupStageComplete: boolean,
): KnockoutRoundAvailability[] {
  const played = playedKnockoutMatchNumbers(knockoutResults);
  const furthest = furthestKnockoutRoundIndex(played);

  return SIMULATION_KNOCKOUT_ROUNDS.map((round, roundIndex) => {
    const isComplete = isKnockoutRoundComplete(played, roundIndex);
    const tierIndex = knockoutRoundTierIndex(round.name);
    const teamsReady = allTeamsResolved(round.matches, fixtures, ctx, teamsById);

    let canSimulate = false;
    let disabledReason: string | undefined;

    if (!groupStageComplete) {
      disabledReason = 'Complete the group stage first';
    } else if (isComplete) {
      disabledReason = 'Round already simulated';
    } else if (furthest > tierIndex) {
      disabledReason = 'A later round has already been simulated';
    } else if (roundIndex > 0) {
      const previousRound = SIMULATION_KNOCKOUT_ROUNDS[roundIndex - 1]!;
      if (!isKnockoutRoundComplete(played, roundIndex - 1)) {
        disabledReason = `Simulate ${ROUND_LABELS[previousRound.name] ?? previousRound.name} first`;
      }
    }

    if (!disabledReason && teamsReady) {
      canSimulate = true;
    } else if (!disabledReason && !teamsReady) {
      disabledReason = 'Teams not yet resolved for this round';
    }

    return {
      name: round.name,
      label: ROUND_LABELS[round.name] ?? round.name,
      matches: round.matches,
      canSimulate,
      isComplete,
      disabledReason,
    };
  });
}

function accumulateScoreline(
  scorelines: Map<string, ScorelineCount>,
  goalsHome: number,
  goalsAway: number,
): void {
  const key = `${goalsHome}:${goalsAway}`;
  const existing = scorelines.get(key);
  if (existing) {
    existing.n += 1;
  } else {
    scorelines.set(key, { goalsHome, goalsAway, n: 1 });
  }
}

function buildOutcomeCounts(homeWin: number, draw: number, awayWin: number): OutcomeCounts {
  return { homeWin, draw, awayWin };
}

function pickSampleScoreline(
  samples: Array<{ goalsHome: number; goalsAway: number }>,
  rng: RandomSource,
): { goalsHome: number; goalsAway: number } | null {
  if (samples.length === 0) return null;
  const index = Math.floor(rng.random() * samples.length);
  return samples[index] ?? null;
}

export function simulatePredictionKnockoutMatch(
  home: Team,
  away: Team,
  mode: ConsensusMode,
  options: {
    count?: number;
    upsetVariance?: number;
    rng?: RandomSource;
  } = {},
): MatchResultRow & { distribution: KnockoutMatchDistribution } {
  const count = options.count ?? PREDICTION_KNOCKOUT_MC_COUNT;
  const rng = options.rng;
  const upsetVariance = options.upsetVariance ?? DEFAULT_UPSET_VARIANCE;

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  const scorelineMap = new Map<string, ScorelineCount>();
  const samples: Array<{ goalsHome: number; goalsAway: number }> = [];

  const homeSim = teamForSimulation(home);
  const awaySim = teamForSimulation(away);
  const homeOffensive = homeSim.offensiveRating ?? homeSim.blendOffensiveRating;
  const awayOffensive = awaySim.offensiveRating ?? awaySim.blendOffensiveRating;

  for (let i = 0; i < count; i++) {
    const outcome = simulateMatchOutcome(home, away, false, { upsetVariance, rng });
    const goalsHome = outcome.goals1;
    const goalsAway = outcome.goals2;
    samples.push({ goalsHome, goalsAway });
    accumulateScoreline(scorelineMap, goalsHome, goalsAway);
    if (goalsHome > goalsAway) homeWin += 1;
    else if (goalsAway > goalsHome) awayWin += 1;
    else draw += 1;
  }

  const scorelines = [...scorelineMap.values()];
  const outcomeCounts = buildOutcomeCounts(homeWin, draw, awayWin);

  let goalsHome: number;
  let goalsAway: number;

  if (mode === 'sample') {
    const sample = pickSampleScoreline(samples, rng ?? { random: () => Math.random() });
    if (!sample) {
      throw new Error('No Monte Carlo samples generated');
    }
    goalsHome = sample.goalsHome;
    goalsAway = sample.goalsAway;
  } else {
    const consensus = chooseConsensus({
      mode,
      outcomeCounts,
      scorelines,
      homeOffensive,
      awayOffensive,
    });
    if (!consensus) {
      throw new Error('Consensus could not pick a scoreline');
    }
    goalsHome = consensus.goalsHome;
    goalsAway = consensus.goalsAway;
  }

  let winnerTeamId = winnerFromGoals(goalsHome, goalsAway, home.id, away.id);
  let penGoalsHome: number | null = null;
  let penGoalsAway: number | null = null;

  if (winnerTeamId == null) {
    const pHome = teamPenaltyRate(home, away);
    const pAway = teamPenaltyRate(away, home);
    const shootout = simulatePenaltyShootout(pHome, pAway, rng ?? { random: () => Math.random() });
    penGoalsHome = shootout.penGoalsHome;
    penGoalsAway = shootout.penGoalsAway;
    winnerTeamId = shootout.homeWins ? home.id : away.id;
  }

  return {
    matchNumber: 0,
    goalsHome,
    goalsAway,
    winnerTeamId,
    penGoalsHome,
    penGoalsAway,
    distribution: {
      homeWin,
      draw,
      awayWin,
      total: count,
      scorelines,
    },
  };
}

export function simulatePredictionKnockoutRound(
  roundName: string,
  fixtures: Fixture[],
  ctx: SlotContext,
  teamsById: Map<number, Team>,
  mode: ConsensusMode,
  options: {
    count?: number;
    upsetVariance?: number;
    rng?: RandomSource;
    ratingsByTeamId?: Map<number, SimulationRatings>;
    isMatchLocked?: (matchNumber: number) => boolean;
  } = {},
): SimulatedPredictionKnockoutMatch[] {
  const round = SIMULATION_KNOCKOUT_ROUNDS.find((entry) => entry.name === roundName);
  if (!round) {
    throw new RangeError(`Unknown knockout round: ${roundName}`);
  }

  const results: SimulatedPredictionKnockoutMatch[] = [];

  for (const matchNumber of round.matches) {
    if (options.isMatchLocked?.(matchNumber)) continue;

    const fixture = fixtures.find((f) => f.matchNumber === matchNumber);
    if (!fixture) continue;

    const { home, away } = resolveMatchTeams(fixture, ctx, teamsById);
    if (!home || !away) {
      throw new Error(`Unresolved participants for match ${matchNumber}`);
    }

    const simulated = simulatePredictionKnockoutMatch(
      ratedTeam(home, options.ratingsByTeamId),
      ratedTeam(away, options.ratingsByTeamId),
      mode,
      options,
    );
    results.push({ ...simulated, matchNumber });
  }

  return results;
}

export function isGroupStageCompleteForPrediction(
  groupMatches: Array<{ status: string }>,
): boolean {
  if (groupMatches.length === 0) return false;
  return groupMatches.every((match) => match.status === 'played');
}
