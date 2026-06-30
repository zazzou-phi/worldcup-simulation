import type { Repository } from '../db/repository.js';
import { parseSlot } from '../engine/bracket.js';
import { hasKickoffPassed } from '../engine/kickoff.js';
import {
  collectPlayedGroupMatches,
  computeAllGroupStandings,
  getQualifyingThirdGroups,
} from '../engine/standings.js';
import type {
  Fixture,
  GroupMembership,
  MasterGroupState,
  MasterKnockoutState,
  OutcomeDistribution,
  ResolvedMatch,
  SimulationMatch,
  Team,
  ActualMatchResult,
} from '../engine/types.js';
import {
  serializeActualResult,
  serializeMasterGroupState,
  serializeMasterKnockoutState,
  serializeMasterTeamStats,
  serializeResolvedMatch,
  serializeTeam,
} from '../api/serialize.js';
import { computeActualPhase } from '../engine/phase.js';

export interface PublicBootstrap {
  teams: ReturnType<typeof serializeTeam>[];
  fixtures: Fixture[];
  groupMemberships: GroupMembership[];
  actualResults: ReturnType<typeof serializeActualResult>[];
}

export interface PublicMeta {
  exportedAt: string;
  revealPolicy: 'kickoff';
  predictionId: number;
  predictionName: string;
}

export interface PublicSnapshot {
  masterGroupState: ReturnType<typeof serializeMasterGroupState>;
  masterKnockoutState: ReturnType<typeof serializeMasterKnockoutState>;
  masterTeamStats: ReturnType<typeof serializeMasterTeamStats>;
  actualResultsState: {
    actualResults: ReturnType<typeof serializeActualResult>[];
    phase: ReturnType<typeof computeActualPhase>;
    groupStandings: MasterGroupState['groupStandings'];
    qualifyingThirdGroups: string[];
    thirdPlaceOrder: MasterKnockoutState['thirdPlaceOrder'];
    resolvedMatches: ReturnType<typeof serializeResolvedMatch>[];
  };
  bootstrap: PublicBootstrap;
  meta: PublicMeta;
}

const EMPTY_DISTRIBUTION: OutcomeDistribution = {
  homeWin: 0,
  draw: 0,
  awayWin: 0,
  total: 0,
  scorelines: [],
};

function isGroupFixtureRevealed(fixture: Fixture, exportTime: Date): boolean {
  if (fixture.group == null) return false;
  return hasKickoffPassed(fixture.date, fixture.time, exportTime);
}

function isKnockoutFixtureRevealed(fixture: Fixture, exportTime: Date): boolean {
  if (fixture.group != null) return false;
  return hasKickoffPassed(fixture.date, fixture.time, exportTime);
}

function revealedKnockoutMatchNumbers(fixtures: Fixture[], exportTime: Date): Set<number> {
  const revealed = new Set<number>();
  for (const fixture of fixtures) {
    if (isKnockoutFixtureRevealed(fixture, exportTime)) {
      revealed.add(fixture.matchNumber);
    }
  }
  return revealed;
}

function isSlotRevealed(
  slot: string,
  matchNumber: number,
  revealedKnockout: ReadonlySet<number>,
): boolean {
  const parsed = parseSlot(slot);
  if (parsed.kind === 'winner' || parsed.kind === 'loser') {
    return parsed.matchNumber != null && revealedKnockout.has(parsed.matchNumber);
  }
  return true;
}

function redactedTeamSide(
  existing: ResolvedMatch,
  side: 'home' | 'away',
  fixture: Fixture,
  revealedKnockout: ReadonlySet<number>,
): { team: Team | null; label: string } {
  const slot = side === 'home' ? fixture.slotHome : fixture.slotAway;
  const fixedTeamId = side === 'home' ? fixture.teamHomeId : fixture.teamAwayId;
  const existingTeam = side === 'home' ? existing.homeTeam : existing.awayTeam;
  const existingLabel = side === 'home' ? existing.homeLabel : existing.awayLabel;

  if (fixedTeamId != null) {
    return { team: existingTeam, label: existingLabel };
  }

  if (!isSlotRevealed(slot, fixture.matchNumber, revealedKnockout)) {
    return { team: null, label: slot };
  }

  return { team: existingTeam, label: existingLabel };
}

function filterRevealedKnockoutActualResults(
  actualResults: ActualMatchResult[],
  fixtures: Fixture[],
  exportTime: Date,
): ActualMatchResult[] {
  const fixtureByMatch = new Map(fixtures.map((fixture) => [fixture.matchNumber, fixture]));
  return actualResults.filter((result) => {
    const fixture = fixtureByMatch.get(result.matchNumber);
    if (fixture == null || fixture.group != null) return true;
    return isKnockoutFixtureRevealed(fixture, exportTime);
  });
}

export function redactMasterKnockoutState(
  state: MasterKnockoutState,
  exportTime: Date,
): MasterKnockoutState {
  const revealedKnockout = revealedKnockoutMatchNumbers(
    state.resolvedMatches.map((match) => match.fixture),
    exportTime,
  );

  const redactedDistributions: Record<number, OutcomeDistribution> = {
    ...state.distributions,
  };

  const resolvedMatches = state.resolvedMatches.map((existing) => {
    const { fixture } = existing;
    const matchRevealed = revealedKnockout.has(fixture.matchNumber);
    if (!matchRevealed) {
      redactedDistributions[fixture.matchNumber] = { ...EMPTY_DISTRIBUTION };
    }

    const homeSide = redactedTeamSide(existing, 'home', fixture, revealedKnockout);
    const awaySide = redactedTeamSide(existing, 'away', fixture, revealedKnockout);

    const result: SimulationMatch = matchRevealed
      ? {
          ...existing.result,
          teamHomeId: homeSide.team?.id ?? null,
          teamAwayId: awaySide.team?.id ?? null,
        }
      : {
          simulationId: 0,
          matchNumber: fixture.matchNumber,
          teamHomeId: homeSide.team?.id ?? null,
          teamAwayId: awaySide.team?.id ?? null,
          goalsHome: null,
          goalsAway: null,
          penGoalsHome: null,
          penGoalsAway: null,
          winnerTeamId: null,
          status: 'scheduled',
        };

    return {
      ...existing,
      result,
      homeTeam: homeSide.team,
      awayTeam: awaySide.team,
      homeLabel: homeSide.label,
      awayLabel: awaySide.label,
    };
  });

  const rounds = state.rounds.map((round) => ({
    ...round,
    isComplete: round.matches.every((matchNumber) => {
      const match = resolvedMatches.find((entry) => entry.fixture.matchNumber === matchNumber);
      return match?.result.status === 'played';
    }),
    canSimulate: false,
  }));

  return {
    ...state,
    resolvedMatches,
    distributions: redactedDistributions,
    rounds,
    hasKnockoutResults: resolvedMatches.some((match) => match.result.status === 'played'),
  };
}

export function redactKnockoutActualResultsView(
  resolvedMatches: ResolvedMatch[],
  exportTime: Date,
): ResolvedMatch[] {
  const revealedKnockout = revealedKnockoutMatchNumbers(
    resolvedMatches.filter((match) => match.fixture.group == null).map((match) => match.fixture),
    exportTime,
  );

  return resolvedMatches.map((existing) => {
    if (existing.fixture.group != null) return existing;

    const { fixture } = existing;
    const matchRevealed = revealedKnockout.has(fixture.matchNumber);
    const homeSide = redactedTeamSide(existing, 'home', fixture, revealedKnockout);
    const awaySide = redactedTeamSide(existing, 'away', fixture, revealedKnockout);

    if (matchRevealed) {
      return {
        ...existing,
        homeTeam: homeSide.team,
        awayTeam: awaySide.team,
        homeLabel: homeSide.label,
        awayLabel: awaySide.label,
        result: {
          ...existing.result,
          teamHomeId: homeSide.team?.id ?? null,
          teamAwayId: awaySide.team?.id ?? null,
        },
      };
    }

    return {
      ...existing,
      homeTeam: homeSide.team,
      awayTeam: awaySide.team,
      homeLabel: homeSide.label,
      awayLabel: awaySide.label,
      isLocked: false,
      result: {
        ...existing.result,
        teamHomeId: homeSide.team?.id ?? null,
        teamAwayId: awaySide.team?.id ?? null,
        goalsHome: null,
        goalsAway: null,
        penGoalsHome: null,
        penGoalsAway: null,
        winnerTeamId: null,
        status: 'scheduled',
      },
    };
  });
}

export function redactMasterGroupState(
  state: MasterGroupState,
  exportTime: Date,
  memberships: GroupMembership[],
  allFixtures: Fixture[],
  actualResults: ActualMatchResult[] = [],
): MasterGroupState {
  const groupFixtures = state.resolvedMatches
    .filter((m) => m.fixture.group != null)
    .map((m) => m.fixture);

  const redactedDistributions: Record<number, OutcomeDistribution> = {
    ...state.distributions,
  };
  const consensusMatches: SimulationMatch[] = [];

  for (const fixture of groupFixtures) {
    const revealed = isGroupFixtureRevealed(fixture, exportTime);
    if (!revealed) {
      redactedDistributions[fixture.matchNumber] = { ...EMPTY_DISTRIBUTION };
      consensusMatches.push({
        simulationId: 0,
        matchNumber: fixture.matchNumber,
        teamHomeId: fixture.teamHomeId,
        teamAwayId: fixture.teamAwayId,
        goalsHome: null,
        goalsAway: null,
        penGoalsHome: null,
        penGoalsAway: null,
        winnerTeamId: null,
        status: 'scheduled',
      });
      continue;
    }

    const existing = state.resolvedMatches.find(
      (m) => m.fixture.matchNumber === fixture.matchNumber,
    )!;
    consensusMatches.push({
      simulationId: 0,
      matchNumber: fixture.matchNumber,
      teamHomeId: fixture.teamHomeId,
      teamAwayId: fixture.teamAwayId,
      goalsHome: existing.result.goalsHome,
      goalsAway: existing.result.goalsAway,
      penGoalsHome: existing.result.penGoalsHome,
      penGoalsAway: existing.result.penGoalsAway,
      winnerTeamId: existing.result.winnerTeamId,
      status: existing.result.status,
    });
  }

  const teamsById = new Map<number, Team>();
  for (const match of state.resolvedMatches) {
    if (match.homeTeam) teamsById.set(match.homeTeam.id, match.homeTeam);
    if (match.awayTeam) teamsById.set(match.awayTeam.id, match.awayTeam);
  }

  const playedGroup = collectPlayedGroupMatches(allFixtures, consensusMatches, actualResults);
  const groupStandings = computeAllGroupStandings(memberships, teamsById, playedGroup);
  const qualifyingThirdGroups = getQualifyingThirdGroups(groupStandings);

  const resolvedMatches: ResolvedMatch[] = groupFixtures.map((fixture) => {
    const existing = state.resolvedMatches.find(
      (m) => m.fixture.matchNumber === fixture.matchNumber,
    )!;
    const result = consensusMatches.find((m) => m.matchNumber === fixture.matchNumber)!;
    return {
      fixture,
      result,
      homeTeam: existing.homeTeam,
      awayTeam: existing.awayTeam,
      homeLabel: existing.homeLabel,
      awayLabel: existing.awayLabel,
      isLocked: existing.isLocked,
    };
  });

  return {
    consensusMode: state.consensusMode,
    resolvedMatches,
    groupStandings,
    qualifyingThirdGroups,
    distributions: redactedDistributions,
  };
}

export function buildPublicSnapshot(
  repo: Repository,
  exportTime: Date = new Date(),
): PublicSnapshot {
  const fixtures = repo.getFixtures();
  const groupMemberships = repo.getGroupMemberships();
  const predictionId = repo.resolvePredictionId();
  const prediction = predictionId != null ? repo.getPrediction(predictionId) : null;
  if (prediction == null) {
    throw new Error('No predictions configured for public export');
  }
  const masterRaw = repo.buildMasterGroupView(prediction.id);
  const actualResults = repo.getActualResults();
  const masterGroupState = redactMasterGroupState(
    masterRaw,
    exportTime,
    groupMemberships,
    fixtures,
    actualResults,
  );
  const masterTeamStats = repo.buildMasterTeamStats(prediction.id);
  const masterKnockoutState = serializeMasterKnockoutState(
    redactMasterKnockoutState(repo.buildMasterKnockoutView(prediction.id), exportTime),
  );
  const actualView = repo.buildActualResultsView();
  const exportedActualResults = filterRevealedKnockoutActualResults(
    actualResults,
    fixtures,
    exportTime,
  );
  const redactedActualResolvedMatches = redactKnockoutActualResultsView(
    actualView.resolvedMatches,
    exportTime,
  );

  const teams = repo.getTeams();

  return {
    masterGroupState: serializeMasterGroupState(masterGroupState),
    masterKnockoutState,
    masterTeamStats: serializeMasterTeamStats(masterTeamStats),
    actualResultsState: {
      actualResults: exportedActualResults.map(serializeActualResult),
      phase: computeActualPhase(exportedActualResults, fixtures),
      groupStandings: actualView.groupStandings,
      qualifyingThirdGroups: actualView.qualifyingThirdGroups,
      thirdPlaceOrder: actualView.thirdPlaceOrder.map((row) => ({
        groupLetter: row.groupLetter,
        position: row.position,
        teamId: row.teamId,
        team: serializeTeam(row.team),
        points: row.points,
        goalDifference: row.goalDifference,
        goalsFor: row.goalsFor,
        qualified: row.qualified,
      })),
      resolvedMatches: redactedActualResolvedMatches.map(serializeResolvedMatch),
    },
    bootstrap: {
      teams: teams.map(serializeTeam),
      fixtures,
      groupMemberships,
      actualResults: exportedActualResults.map(serializeActualResult),
    },
    meta: {
      exportedAt: exportTime.toISOString(),
      revealPolicy: 'kickoff',
      predictionId: prediction.id,
      predictionName: prediction.name,
    },
  };
}

export function snapshotToFiles(snapshot: PublicSnapshot): Record<string, unknown> {
  return {
    'master-group-state.json': snapshot.masterGroupState,
    'master-knockout-state.json': snapshot.masterKnockoutState,
    'master-team-stats.json': snapshot.masterTeamStats,
    'actual-results-state.json': snapshot.actualResultsState,
    'bootstrap.json': snapshot.bootstrap,
    'meta.json': snapshot.meta,
  };
}
