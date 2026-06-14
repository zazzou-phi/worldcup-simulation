import {
  GROUP_GAMES_MATCHDAY_CUTOFF,
  isGroupFixtureWithinGamesTarget,
  type GroupGamesTarget,
} from '@shared/engine/groupSimulation.js';
import { SIMULATION_KNOCKOUT_ROUNDS } from '@shared/engine/simulationRounds.js';
import type { Fixture, OutcomeDistribution, ResolvedMatch, TournamentState } from '../types.js';

const KNOCKOUT_ROUND_LABELS: Record<string, string> = {
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-final',
  semi_final: 'Semi-final',
  third_place: 'Third place',
  final: 'Final',
};

const GROUP_ROUND_LABELS: Record<GroupGamesTarget, string> = {
  1: 'Group round 1',
  2: 'Group round 2',
  3: 'Group round 3',
};

export interface MatchOutcomeCounts {
  homeWins: number;
  draws: number;
  awayWins: number;
}

export interface RoundGoalStats {
  key: string;
  label: string;
  stage: 'group' | 'knockout';
  matchesPlayed: number;
  matchesScheduled: number;
  totalGoals: number;
  outcomes: MatchOutcomeCounts;
}

export interface TeamScoringRow {
  teamId: number;
  teamName: string;
  flag: string;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  won: number;
  drawn: number;
  lost: number;
  /** Simulation only: baseline Elo at kickoff. */
  startingElo?: number;
  /** Simulation only: effective Elo after tournament form updates. */
  endingElo?: number;
  eloDelta?: number;
}

export interface TournamentStats {
  matchesPlayed: number;
  matchesScheduled: number;
  totalGoals: number;
  avgGoalsPerMatch: number | null;
  groupOutcomes: MatchOutcomeCounts;
  knockoutOutcomes: MatchOutcomeCounts;
  rounds: RoundGoalStats[];
  topScorers: TeamScoringRow[];
  cleanSheets: number;
  goallessDraws: number;
  highestScoringMatch: {
    matchNumber: number;
    label: string;
    totalGoals: number;
    scoreline: string;
  } | null;
  champion: { teamId: number; teamName: string; flag: string } | null;
  groupOnly: boolean;
}

export interface PoolTournamentStats {
  simulationSamples: number;
  matchesWithData: number;
  matchesScheduled: number;
  totalOutcomes: number;
  totalGoals: number;
  avgGoalsPerMatch: number | null;
  outcomes: MatchOutcomeCounts;
  rounds: RoundGoalStats[];
}

function isExclusiveGroupRound(fixture: Pick<Fixture, 'group' | 'round'>, round: GroupGamesTarget): boolean {
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

function emptyOutcomes(): MatchOutcomeCounts {
  return { homeWins: 0, draws: 0, awayWins: 0 };
}

function addOutcome(outcomes: MatchOutcomeCounts, goalsHome: number, goalsAway: number): void {
  if (goalsHome > goalsAway) {
    outcomes.homeWins += 1;
  } else if (goalsHome < goalsAway) {
    outcomes.awayWins += 1;
  } else {
    outcomes.draws += 1;
  }
}

function matchLabel(match: ResolvedMatch): string {
  return `${match.homeLabel} vs ${match.awayLabel}`;
}

function playedMatches(resolvedMatches: ResolvedMatch[]): ResolvedMatch[] {
  return resolvedMatches.filter((match) => match.result.status === 'played');
}

function goalsFromMatch(match: ResolvedMatch): { home: number; away: number; total: number } | null {
  const { goalsHome, goalsAway } = match.result;
  if (goalsHome == null || goalsAway == null) return null;
  return { home: goalsHome, away: goalsAway, total: goalsHome + goalsAway };
}

function buildRoundBuckets(fixtures: Fixture[]): {
  group: Map<GroupGamesTarget, Set<number>>;
  knockout: Map<string, Set<number>>;
} {
  const group = new Map<GroupGamesTarget, Set<number>>([
    [1, new Set()],
    [2, new Set()],
    [3, new Set()],
  ]);
  const knockout = new Map<string, Set<number>>();

  for (const round of SIMULATION_KNOCKOUT_ROUNDS) {
    knockout.set(round.name, new Set(round.matches));
  }

  for (const fixture of fixtures) {
    if (fixture.group != null) {
      for (const round of [1, 2, 3] as const) {
        if (isExclusiveGroupRound(fixture, round)) {
          group.get(round)!.add(fixture.matchNumber);
        }
      }
    }
  }

  return { group, knockout };
}

function accumulateTeamStats(
  rows: Map<number, TeamScoringRow>,
  match: ResolvedMatch,
  goals: { home: number; away: number },
): void {
  const homeId = match.result.teamHomeId;
  const awayId = match.result.teamAwayId;
  if (homeId == null || awayId == null) return;

  const homeTeam = match.homeTeam;
  const awayTeam = match.awayTeam;
  if (!homeTeam || !awayTeam) return;

  const homeRow =
    rows.get(homeId) ??
    ({
      teamId: homeId,
      teamName: homeTeam.name,
      flag: homeTeam.flag,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      won: 0,
      drawn: 0,
      lost: 0,
    } satisfies TeamScoringRow);
  const awayRow =
    rows.get(awayId) ??
    ({
      teamId: awayId,
      teamName: awayTeam.name,
      flag: awayTeam.flag,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      won: 0,
      drawn: 0,
      lost: 0,
    } satisfies TeamScoringRow);

  homeRow.goalsFor += goals.home;
  homeRow.goalsAgainst += goals.away;
  awayRow.goalsFor += goals.away;
  awayRow.goalsAgainst += goals.home;

  if (goals.home > goals.away) {
    homeRow.won += 1;
    awayRow.lost += 1;
  } else if (goals.home < goals.away) {
    homeRow.lost += 1;
    awayRow.won += 1;
  } else {
    homeRow.drawn += 1;
    awayRow.drawn += 1;
  }

  rows.set(homeId, homeRow);
  rows.set(awayId, awayRow);
}

export function computeTournamentStatsFromMatches(
  resolvedMatches: ResolvedMatch[],
  fixtures: Fixture[],
  options: { groupOnly?: boolean } = {},
): TournamentStats {
  const groupOnly = options.groupOnly ?? false;
  const activeFixtures = groupOnly ? fixtures.filter((fixture) => fixture.group != null) : fixtures;
  const played = playedMatches(resolvedMatches);
  const buckets = buildRoundBuckets(activeFixtures);

  const roundStats = new Map<string, RoundGoalStats>();
  const initRound = (key: string, label: string, stage: 'group' | 'knockout', scheduled: number) => {
    roundStats.set(key, {
      key,
      label,
      stage,
      matchesPlayed: 0,
      matchesScheduled: scheduled,
      totalGoals: 0,
      outcomes: emptyOutcomes(),
    });
  };

  for (const round of [1, 2, 3] as const) {
    initRound(`group:${round}`, GROUP_ROUND_LABELS[round], 'group', buckets.group.get(round)!.size);
  }
  if (!groupOnly) {
    for (const round of SIMULATION_KNOCKOUT_ROUNDS) {
      initRound(
        round.name,
        KNOCKOUT_ROUND_LABELS[round.name] ?? round.name,
        'knockout',
        round.matches.length,
      );
    }
  }

  const groupOutcomes = emptyOutcomes();
  const knockoutOutcomes = emptyOutcomes();
  const teamRows = new Map<number, TeamScoringRow>();

  let totalGoals = 0;
  let cleanSheets = 0;
  let goallessDraws = 0;
  let highestScoringMatch: TournamentStats['highestScoringMatch'] = null;

  for (const match of played) {
    const goals = goalsFromMatch(match);
    if (!goals) continue;

    totalGoals += goals.total;
    accumulateTeamStats(teamRows, match, goals);

    if (goals.home === 0 || goals.away === 0) {
      cleanSheets += 1;
    }
    if (goals.home === 0 && goals.away === 0) {
      goallessDraws += 1;
    }

    if (!highestScoringMatch || goals.total > highestScoringMatch.totalGoals) {
      highestScoringMatch = {
        matchNumber: match.fixture.matchNumber,
        label: matchLabel(match),
        totalGoals: goals.total,
        scoreline: `${goals.home}–${goals.away}`,
      };
    }

    const isGroup = match.fixture.group != null;
    const outcomes = isGroup ? groupOutcomes : knockoutOutcomes;
    addOutcome(outcomes, goals.home, goals.away);

    let roundKey: string | null = null;
    if (isGroup) {
      for (const round of [1, 2, 3] as const) {
        if (buckets.group.get(round)!.has(match.fixture.matchNumber)) {
          roundKey = `group:${round}`;
          break;
        }
      }
    } else if (!groupOnly) {
      for (const round of SIMULATION_KNOCKOUT_ROUNDS) {
        if (buckets.knockout.get(round.name)!.has(match.fixture.matchNumber)) {
          roundKey = round.name;
          break;
        }
      }
    }

    if (roundKey) {
      const row = roundStats.get(roundKey);
      if (row) {
        row.matchesPlayed += 1;
        row.totalGoals += goals.total;
        addOutcome(row.outcomes, goals.home, goals.away);
      }
    }
  }

  const topScorers = [...teamRows.values()]
    .map((row) => ({
      ...row,
      goalDifference: row.goalsFor - row.goalsAgainst,
    }))
    .sort(
      (a, b) =>
        b.goalsFor - a.goalsFor ||
        b.goalDifference - a.goalDifference ||
        a.teamName.localeCompare(b.teamName),
    );

  const finalMatch = groupOnly
    ? null
    : resolvedMatches.find((match) => match.fixture.matchNumber === 104);
  const champion =
    finalMatch?.result.status === 'played' && finalMatch.result.winnerTeamId != null
      ? (() => {
          const winner =
            finalMatch.result.winnerTeamId === finalMatch.result.teamHomeId
              ? finalMatch.homeTeam
              : finalMatch.awayTeam;
          return winner
            ? { teamId: winner.id, teamName: winner.name, flag: winner.flag }
            : null;
        })()
      : null;

  const rounds = [...roundStats.values()].filter((round) => round.matchesScheduled > 0);

  return {
    matchesPlayed: played.length,
    matchesScheduled: activeFixtures.length,
    totalGoals,
    avgGoalsPerMatch: played.length > 0 ? totalGoals / played.length : null,
    groupOutcomes,
    knockoutOutcomes,
    rounds,
    topScorers,
    cleanSheets,
    goallessDraws,
    highestScoringMatch,
    champion,
    groupOnly,
  };
}

function playedTeamIds(resolvedMatches: ResolvedMatch[]): Set<number> {
  const ids = new Set<number>();
  for (const match of resolvedMatches) {
    if (match.result.status !== 'played') continue;
    if (match.result.teamHomeId != null) ids.add(match.result.teamHomeId);
    if (match.result.teamAwayId != null) ids.add(match.result.teamAwayId);
  }
  return ids;
}

function formatEloDelta(delta: number): string {
  if (delta === 0) return '0';
  const rounded = Math.round(delta);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function computeTeamEloById(state: TournamentState): Map<number, Pick<TeamScoringRow, 'startingElo' | 'endingElo' | 'eloDelta'>> {
  const participants = playedTeamIds(state.resolvedMatches);
  const byId = new Map<number, Pick<TeamScoringRow, 'startingElo' | 'endingElo' | 'eloDelta'>>();

  for (const team of Object.values(state.teams)) {
    if (!participants.has(team.id)) continue;
    const deltaRaw = state.eloDeltas?.[String(team.id)] ?? 0;
    const startingElo = team.elo;
    const endingElo = Math.round(startingElo + deltaRaw);
    byId.set(team.id, {
      startingElo,
      endingElo,
      eloDelta: endingElo - startingElo,
    });
  }

  return byId;
}

export function computeTournamentStats(state: TournamentState): TournamentStats {
  const base = computeTournamentStatsFromMatches(state.resolvedMatches, state.fixtures);
  const eloByTeam = computeTeamEloById(state);

  return {
    ...base,
    topScorers: base.topScorers.map((row) => ({
      ...row,
      ...eloByTeam.get(row.teamId),
    })),
  };
}

function distributionForMatch(
  distributions: Record<string, OutcomeDistribution>,
  matchNumber: number,
): OutcomeDistribution | undefined {
  return distributions[String(matchNumber)] ?? distributions[matchNumber as unknown as string];
}

export function computePoolStats(
  distributions: Record<string, OutcomeDistribution>,
  fixtures: Fixture[],
): PoolTournamentStats {
  const groupFixtures = fixtures.filter((fixture) => fixture.group != null);
  const buckets = buildRoundBuckets(groupFixtures);

  const roundStats = new Map<string, RoundGoalStats>();
  for (const round of [1, 2, 3] as const) {
    roundStats.set(`group:${round}`, {
      key: `group:${round}`,
      label: GROUP_ROUND_LABELS[round],
      stage: 'group',
      matchesPlayed: 0,
      matchesScheduled: buckets.group.get(round)!.size,
      totalGoals: 0,
      outcomes: emptyOutcomes(),
    });
  }

  const outcomes = emptyOutcomes();
  let matchesWithData = 0;
  let totalOutcomes = 0;
  let totalGoals = 0;
  let simulationSamples = 0;

  for (const fixture of groupFixtures) {
    const dist = distributionForMatch(distributions, fixture.matchNumber);
    if (!dist || dist.total === 0) continue;

    matchesWithData += 1;
    totalOutcomes += dist.total;
    simulationSamples = Math.max(simulationSamples, dist.total);

    outcomes.homeWins += dist.homeWin;
    outcomes.draws += dist.draw;
    outcomes.awayWins += dist.awayWin;

    let matchGoals = 0;
    for (const scoreline of dist.scorelines) {
      matchGoals += (scoreline.goalsHome + scoreline.goalsAway) * scoreline.n;
    }
    totalGoals += matchGoals;

    for (const round of [1, 2, 3] as const) {
      if (!buckets.group.get(round)!.has(fixture.matchNumber)) continue;
      const row = roundStats.get(`group:${round}`);
      if (!row) break;
      row.matchesPlayed += 1;
      row.totalGoals += matchGoals;
      row.outcomes.homeWins += dist.homeWin;
      row.outcomes.draws += dist.draw;
      row.outcomes.awayWins += dist.awayWin;
      break;
    }
  }

  return {
    simulationSamples,
    matchesWithData,
    matchesScheduled: groupFixtures.length,
    totalOutcomes,
    totalGoals,
    avgGoalsPerMatch: totalOutcomes > 0 ? totalGoals / totalOutcomes : null,
    outcomes,
    rounds: [...roundStats.values()].filter((round) => round.matchesScheduled > 0),
  };
}

export function formatPoolOutcomeSummary(outcomes: MatchOutcomeCounts, total: number): string {
  if (total === 0) return 'No data';
  const pct = (count: number) => `${((count / total) * 100).toFixed(1)}%`;
  return [
    `${outcomes.homeWins.toLocaleString()} home (${pct(outcomes.homeWins)})`,
    `${outcomes.draws.toLocaleString()} draw (${pct(outcomes.draws)})`,
    `${outcomes.awayWins.toLocaleString()} away (${pct(outcomes.awayWins)})`,
  ].join(' · ');
}

// Legacy export block removed - computeTournamentStats now delegates above

export function formatOutcomeSummary(outcomes: MatchOutcomeCounts): string {
  const parts = [
    `${outcomes.homeWins} home win${outcomes.homeWins === 1 ? '' : 's'}`,
    `${outcomes.draws} draw${outcomes.draws === 1 ? '' : 's'}`,
    `${outcomes.awayWins} away win${outcomes.awayWins === 1 ? '' : 's'}`,
  ];
  return parts.join(' · ');
}

export { formatEloDelta };

export { GROUP_GAMES_MATCHDAY_CUTOFF };
