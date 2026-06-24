import type { Repository } from '../db/repository.js';
import type { Fixture, SimulationMatch, Team } from '../engine/types.js';
import { compareFixturesChronologically } from '../engine/fixtureOrder.js';
import {
  collectPlayedGroupMatches,
  computeAllGroupStandings,
} from '../engine/standings.js';
import { buildSlotContext, resolveMatchTeams } from '../engine/bracket.js';
import {
  simulateMatchOutcome,
  winnerFromGoals,
  type RandomSource,
  defaultRandomSource,
  DEFAULT_UPSET_VARIANCE,
} from '../engine/matchSimulator.js';
import { teamForSimulation } from '../engine/teamRatings.js';
import {
  computeSimulationRatings,
  recomputeEloDeltasFromSimulationState,
  type SimulationRatings,
} from '../engine/tournamentElo.js';
import { SIMULATION_KNOCKOUT_ROUNDS, FINAL_MATCH_NUMBER } from '../engine/simulationRounds.js';

export const MONTE_CARLO_MAX_COUNT = 100_000;

export interface MonteCarloTeamResult {
  teamId: number;
  teamName: string;
  countryCode: string | null;
  flag: string;
  wins: number;
  winPct: number;
}

export interface MonteCarloResult {
  count: number;
  elapsedMs: number;
  champions: MonteCarloTeamResult[];
  batchName: string;
  firstSimulationId: number;
  lastSimulationId: number;
}

interface TournamentOutcome {
  championId: number | null;
  matches: SimulationMatch[];
}

interface MonteCarloEngine {
  simulateTournament(rng: RandomSource): TournamentOutcome;
}

export interface MonteCarloOptions {
  rng?: RandomSource;
  upsetVariance?: number;
  onProgress?: (completed: number, total: number) => void | Promise<void>;
}

function shouldReportProgress(completed: number, total: number): boolean {
  if (completed === total) return true;
  const step = Math.max(1, Math.floor(total / 100));
  return completed % step === 0;
}

function buildEngine(
  repo: Repository,
  upsetVariance: number = DEFAULT_UPSET_VARIANCE,
): MonteCarloEngine {
  const teams = repo.getTeams();
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const eloWeight = repo.getRatingEloWeight();
  const deltaWeight = repo.getTournamentEloDeltaWeight();
  const fixtures = repo.getFixtures();
  const memberships = repo.getGroupMemberships();
  const actualResults = repo.getActualResults();
  const lockedMatches = new Set(actualResults.map((r) => r.matchNumber));

  const groupFixtures = fixtures
    .filter((f) => f.group != null)
    .sort(compareFixturesChronologically);

  const initialMatches = createInitialMatches(fixtures, actualResults);
  const matches = new Map<number, SimulationMatch>();
  let simulationRatings = new Map<number, SimulationRatings>();

  function resetMatches(): void {
    matches.clear();
    for (const match of initialMatches) {
      matches.set(match.matchNumber, { ...match });
    }
    refreshSimulationRatings();
  }

  function refreshSimulationRatings(): void {
    const matchList = [...matches.values()];
    const deltas = recomputeEloDeltasFromSimulationState(teams, fixtures, matchList);
    simulationRatings = computeSimulationRatings(teams, deltas, eloWeight, deltaWeight);
  }

  function simTeam(teamId: number): Team {
    const team = teamsById.get(teamId)!;
    return teamForSimulation(team, simulationRatings.get(teamId));
  }

  function syncParticipants(): void {
    const matchList = [...matches.values()];
    const playedGroup = collectPlayedGroupMatches(fixtures, matchList, actualResults);
    const groupStandings = computeAllGroupStandings(memberships, teamsById, playedGroup);
    const thirdPlaceOrder = repo.getEnsuredThirdPlaceOrder(groupStandings);
    const ctx = buildSlotContext(groupStandings, fixtures, matchList, teamsById, thirdPlaceOrder);

    for (const fixture of fixtures) {
      const { home, away } = resolveMatchTeams(fixture, ctx, teamsById);
      const match = matches.get(fixture.matchNumber)!;
      match.teamHomeId = home?.id ?? null;
      match.teamAwayId = away?.id ?? null;
    }
  }

  function playMatch(matchNumber: number, knockout: boolean, rng: RandomSource): void {
    refreshSimulationRatings();
    const match = matches.get(matchNumber)!;
    const homeId = match.teamHomeId;
    const awayId = match.teamAwayId;
    if (homeId == null || awayId == null) {
      throw new Error(`Match ${matchNumber} has unresolved participants`);
    }

    const home = simTeam(homeId);
    const away = simTeam(awayId);
    const outcome = simulateMatchOutcome(home, away, knockout, { rng, upsetVariance });
    const winnerTeamId = knockout
      ? (outcome.winnerId ?? null)
      : winnerFromGoals(outcome.goals1, outcome.goals2, homeId, awayId);

    match.goalsHome = outcome.goals1;
    match.goalsAway = outcome.goals2;
    match.penGoalsHome = outcome.penGoalsHome ?? null;
    match.penGoalsAway = outcome.penGoalsAway ?? null;
    match.winnerTeamId = winnerTeamId;
    match.status = 'played';
  }

  return {
    simulateTournament(rng: RandomSource): TournamentOutcome {
      resetMatches();
      syncParticipants();

      for (const fixture of groupFixtures) {
        const { matchNumber } = fixture;
        if (lockedMatches.has(matchNumber)) continue;
        const match = matches.get(matchNumber)!;
        if (match.status === 'played') continue;
        playMatch(matchNumber, false, rng);
      }

      syncParticipants();

      for (const round of SIMULATION_KNOCKOUT_ROUNDS) {
        for (const matchNumber of round.matches) {
          if (lockedMatches.has(matchNumber)) continue;
          const match = matches.get(matchNumber)!;
          if (match.status === 'played') continue;
          playMatch(matchNumber, true, rng);
        }
        syncParticipants();
      }

      return {
        championId: matches.get(FINAL_MATCH_NUMBER)?.winnerTeamId ?? null,
        matches: [...matches.values()].map((match) => ({ ...match })),
      };
    },
  };
}

function createInitialMatches(
  fixtures: Fixture[],
  actualResults: Array<{
    matchNumber: number;
    goalsHome: number;
    goalsAway: number;
    winnerTeamId: number | null;
  }>,
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
      penGoalsHome: null,
      penGoalsAway: null,
      winnerTeamId: actual?.winnerTeamId ?? null,
      status: actual ? ('played' as const) : ('scheduled' as const),
    };
  });
}

function createBatchName(): string {
  return `Bulk ${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
}

export async function runMonteCarlo(
  repo: Repository,
  count: number,
  options: MonteCarloOptions = {},
): Promise<MonteCarloResult> {
  if (!Number.isInteger(count) || count < 1 || count > MONTE_CARLO_MAX_COUNT) {
    throw new RangeError(`count must be an integer from 1 to ${MONTE_CARLO_MAX_COUNT}`);
  }

  const rng = options.rng ?? defaultRandomSource;
  const upsetVariance = options.upsetVariance ?? DEFAULT_UPSET_VARIANCE;
  const engine = buildEngine(repo, upsetVariance);
  const winCounts = new Map<number, number>();
  const teamsById = new Map(repo.getTeams().map((t) => [t.id, t]));
  const batchName = createBatchName();
  let firstSimulationId = 0;
  let lastSimulationId = 0;

  const started = performance.now();
  const onProgress = options.onProgress;
  for (let i = 0; i < count; i++) {
    const { championId, matches } = engine.simulateTournament(rng);
    const simulation = repo.importCompletedTournament(`${batchName} #${i + 1}`, matches, {
      deferMasterStats: true,
    });
    if (i === 0) firstSimulationId = simulation.id;
    lastSimulationId = simulation.id;

    if (championId != null) {
      winCounts.set(championId, (winCounts.get(championId) ?? 0) + 1);
    }

    const completed = i + 1;
    if (onProgress && shouldReportProgress(completed, count)) {
      await onProgress(completed, count);
    }
  }
  const elapsedMs = performance.now() - started;
  repo.rebuildAllPredictionAggregates();

  const champions = [...winCounts.entries()]
    .map(([teamId, wins]) => toTeamResult(teamId, wins, count, teamsById))
    .sort((a, b) => b.wins - a.wins || a.teamName.localeCompare(b.teamName));

  return {
    count,
    elapsedMs,
    champions,
    batchName,
    firstSimulationId,
    lastSimulationId,
  };
}

function toTeamResult(
  teamId: number,
  wins: number,
  total: number,
  teamsById: Map<number, Team>,
): MonteCarloTeamResult {
  const team = teamsById.get(teamId);
  return {
    teamId,
    teamName: team?.name ?? `Team ${teamId}`,
    countryCode: team?.countryCode ?? null,
    flag: team?.flag ?? '',
    wins,
    winPct: (wins / total) * 100,
  };
}
