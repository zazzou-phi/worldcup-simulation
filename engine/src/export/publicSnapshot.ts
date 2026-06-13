import type { Repository } from '../db/repository.js';
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
  OutcomeDistribution,
  ResolvedMatch,
  SimulationMatch,
  Team,
} from '../engine/types.js';
import {
  serializeActualResult,
  serializeMasterGroupState,
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
  masterTeamStats: ReturnType<typeof serializeMasterTeamStats>;
  actualResultsState: {
    actualResults: ReturnType<typeof serializeActualResult>[];
    phase: ReturnType<typeof computeActualPhase>;
    groupStandings: MasterGroupState['groupStandings'];
    qualifyingThirdGroups: string[];
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

export function redactMasterGroupState(
  state: MasterGroupState,
  exportTime: Date,
  memberships: GroupMembership[],
  allFixtures: Fixture[],
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
      winnerTeamId: existing.result.winnerTeamId,
      status: existing.result.status,
    });
  }

  const teamsById = new Map<number, Team>();
  for (const match of state.resolvedMatches) {
    if (match.homeTeam) teamsById.set(match.homeTeam.id, match.homeTeam);
    if (match.awayTeam) teamsById.set(match.awayTeam.id, match.awayTeam);
  }

  const playedGroup = collectPlayedGroupMatches(allFixtures, consensusMatches, []);
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
  const masterGroupState = redactMasterGroupState(
    masterRaw,
    exportTime,
    groupMemberships,
    fixtures,
  );
  const masterTeamStats = repo.buildMasterTeamStats(prediction.id);
  const actualView = repo.buildActualResultsView();

  const teams = repo.getTeams();
  const actualResults = repo.getActualResults();

  return {
    masterGroupState: serializeMasterGroupState(masterGroupState),
    masterTeamStats: serializeMasterTeamStats(masterTeamStats),
    actualResultsState: {
      actualResults: actualView.actualResults.map(serializeActualResult),
      phase: actualView.phase,
      groupStandings: actualView.groupStandings,
      qualifyingThirdGroups: actualView.qualifyingThirdGroups,
      resolvedMatches: actualView.resolvedMatches.map(serializeResolvedMatch),
    },
    bootstrap: {
      teams: teams.map(serializeTeam),
      fixtures,
      groupMemberships,
      actualResults: actualResults.map(serializeActualResult),
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
    'master-team-stats.json': snapshot.masterTeamStats,
    'actual-results-state.json': snapshot.actualResultsState,
    'bootstrap.json': snapshot.bootstrap,
    'meta.json': snapshot.meta,
  };
}
