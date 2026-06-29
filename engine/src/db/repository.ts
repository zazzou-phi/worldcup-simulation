import { eq, and, desc, sql, inArray, count } from 'drizzle-orm';
import type { Db } from './client.js';
import * as schema from './schema.js';
import type {
  Team,
  Fixture,
  Simulation,
  SimulationListEntry,
  SimulationListPage,
  SimulationMatch,
  GroupMembership,
  TournamentState,
  ResolvedMatch,
  ActualMatchResult,
  MatchStatus,
  MasterGroupState,
  MasterKnockoutState,
  MasterTeamStats,
  OutcomeDistribution,
  Prediction,
  PredictionListEntry,
  PredictionListPage,
  ValidateSelectionResult,
  RatingEloWeight,
  TournamentEloDeltaWeight,
  ThirdPlaceOrderRow,
} from '../engine/types.js';
import { chooseConsensus, getDefaultConsensusMode, parseConsensusMode } from '../engine/consensus.js';
import { winnerFromGoals } from '../engine/matchSimulator.js';
import { computeBlendedNormalizedRatings, teamForSimulation } from '../engine/teamRatings.js';
import {
  computeSimulationRatings,
  recomputeEloDeltasFromSimulationState,
  type SimulationRatings,
} from '../engine/tournamentElo.js';
import { DEFAULT_RATING_ELO_WEIGHT } from '../api/ratingEloWeight.js';
import { DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT } from '../api/tournamentEloDeltaWeight.js';
import { MatchLockedError, MatchClearBlockedError, ActualResultError, FrozenMatchError } from './errors.js';
import {
  collectPlayedGroupMatches,
  computeAllGroupStandings,
  getQualifyingThirdGroups,
  getQualifyingThirdGroupsKey,
} from '../engine/standings.js';
import {
  buildSlotContext,
  lookupAnnexC,
  resolveMatchTeams,
} from '../engine/bracket.js';
import {
  buildTournamentStateFromData,
  syncResolvedParticipantsInMemory,
} from '../engine/tournamentState.js';
import {
  canClearActualResult,
  canClearSimulationResult,
  canModifyActualResult,
  canModifySimulationResult,
  computeActualPhase,
  KNOCKOUT_ELIGIBLE_PHASES,
} from '../engine/phase.js';
import {
  buildPredictionKnockoutRatings,
  buildPredictionSlotContext,
  buildThirdPlaceOrderRows,
  canResimulateKnockoutMatch,
  canResimulateKnockoutRound,
  computeKnockoutRoundAvailability,
  findKnockoutRoundNameForMatch,
  getQualifyingThirdGroupsFromOrder,
  isGroupStageCompleteForPrediction,
  ratedTeam,
  simulatePredictionKnockoutMatch,
  simulatePredictionKnockoutRound,
  type ThirdPlaceOrderEntry,
} from '../engine/predictionKnockout.js';
import { validateThirdPlaceOrder } from '../engine/thirdPlaceOrder.js';
import {
  clearKnockoutResultsAfterRound,
  clearKnockoutResultsFromRoundOnward,
  clearPredictionKnockoutResults,
  deletePredictionKnockoutData,
  hasPredictionKnockoutResults,
  readPredictionKnockoutResults,
  writePredictionKnockoutRound,
} from './predictionKnockoutStorage.js';
import {
  clearActiveKnockoutSimulation,
  createPredictionKnockoutRun,
  ensureKnockoutRunForPrediction,
  isKnockoutRunSimulationId,
  listKnockoutRunsForPrediction,
  readKnockoutResultsFromSimulation,
  setActiveKnockoutSimulation,
} from './predictionKnockoutRuns.js';
import {
  ensureActualThirdPlaceOrder,
  writeActualThirdPlaceOrder,
} from './actualThirdPlaceStorage.js';
import {
  deletePredictionAggregates,
  readPredictionMatchDistributions,
  readPredictionTeamStats,
  rebuildAllPredictionAggregates,
  rebuildPredictionAggregates,
  refreshSimulationInPredictionAggregates,
  removeSimulationFromPredictionAggregates,
} from './predictionAggregates.js';
import {
  backfillFrozenMatchesForPrediction,
  clearFrozenMatch,
  copyMissingFrozenMatchesFromDefault,
  syncCanonicalLockedSampleGoalsFromDefault,
  applyCanonicalLockedConsensusFromActuals,
  readCanonicalLockedSampleGoals,
  readLockedMatchSampleGoalsFromActuals,
  resolveLockedSamplePredictionForEntry,
  freezeMatchForAllPredictions,
  readEffectiveFrozenMatchDistributions,
  setFrozenMatchConsensusMode,
} from './predictionFrozenMatches.js';
import {
  deletePredictionSampleResults,
  performPredictionSample as runPredictionSample,
  performPredictionSampleMatch as runPredictionSampleMatch,
  readPredictionSampleResults,
  readPredictionSampleSummary,
  PredictionSampleError,
} from './predictionSample.js';
import {
  formatSelectionSpec,
  parseSelectionInput,
  parseSelectionSpecJson,
  serializeSelectionSpec,
  simulationIdInSpec,
  type SelectionSpec,
} from '../lib/simulationSelection.js';

function mapTeam(row: typeof schema.teams.$inferSelect): Team {
  return {
    id: row.id,
    name: row.name,
    countryCode: row.countryCode,
    flag: row.flag,
    rank: row.rank,
    rating: row.rating,
    elo: row.elo,
    total: row.total,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    eloOffensiveRating: row.eloOffensiveRating,
    eloDefensiveRating: row.eloDefensiveRating,
    goalOffensiveRating: row.goalOffensiveRating,
    goalDefensiveRating: row.goalDefensiveRating,
    blendOffensiveRating: row.blendOffensiveRating,
    blendDefensiveRating: row.blendDefensiveRating,
  };
}

function mapFixture(row: typeof schema.fixtures.$inferSelect): Fixture {
  return {
    matchNumber: row.matchNumber,
    round: row.round,
    date: row.date,
    time: row.time,
    venue: row.venue,
    group: row.group,
    slotHome: row.slotHome,
    slotAway: row.slotAway,
    teamHomeId: row.teamHomeId,
    teamAwayId: row.teamAwayId,
  };
}

function mapPrediction(row: typeof schema.predictions.$inferSelect): Prediction {
  return {
    id: row.id,
    name: row.name,
    selectionSpec: parseSelectionSpecJson(row.selectionSpec),
    consensusMode: parseConsensusMode(row.consensusMode),
    activeKnockoutSimulationId: row.activeKnockoutSimulationId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapSimulation(row: typeof schema.simulations.$inferSelect): Simulation {
  return {
    id: row.id,
    name: row.name,
    phase: row.phase,
    annexCCombinationId: row.annexCCombinationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMatch(row: typeof schema.simulationMatches.$inferSelect): SimulationMatch {
  return {
    simulationId: row.simulationId,
    matchNumber: row.matchNumber,
    teamHomeId: row.teamHomeId,
    teamAwayId: row.teamAwayId,
    goalsHome: row.goalsHome,
    goalsAway: row.goalsAway,
    penGoalsHome: row.penGoalsHome,
    penGoalsAway: row.penGoalsAway,
    winnerTeamId: row.winnerTeamId,
    status: row.status,
  };
}

function mapActualResult(row: typeof schema.actualMatchResults.$inferSelect): ActualMatchResult {
  return {
    matchNumber: row.matchNumber,
    goalsHome: row.goalsHome,
    goalsAway: row.goalsAway,
    winnerTeamId: row.winnerTeamId,
    recordedAt: row.recordedAt,
    predictedGoalsHome: row.predictedGoalsHome,
    predictedGoalsAway: row.predictedGoalsAway,
  };
}

function lowestUnusedId(usedIds: Iterable<number>): number {
  const used = new Set(usedIds);
  let id = 1;
  while (used.has(id)) id++;
  return id;
}

export class Repository {
  constructor(private db: Db) {}

  getTeams(): Team[] {
    return this.db.select().from(schema.teams).all().map(mapTeam);
  }

  getRatingEloWeight(): RatingEloWeight {
    const row = this.db
      .select({ ratingEloWeight: schema.appSettings.ratingEloWeight })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.id, 1))
      .get();
    return row?.ratingEloWeight ?? DEFAULT_RATING_ELO_WEIGHT;
  }

  setRatingEloWeight(eloWeight: RatingEloWeight): RatingEloWeight {
    const deltaWeight = this.getTournamentEloDeltaWeight();
    this.db
      .insert(schema.appSettings)
      .values({ id: 1, ratingEloWeight: eloWeight, tournamentEloDeltaWeight: deltaWeight })
      .onConflictDoUpdate({
        target: schema.appSettings.id,
        set: { ratingEloWeight: eloWeight },
      })
      .run();
    this.recomputeBlendRatings(eloWeight);
    return eloWeight;
  }

  getTournamentEloDeltaWeight(): TournamentEloDeltaWeight {
    const row = this.db
      .select({ tournamentEloDeltaWeight: schema.appSettings.tournamentEloDeltaWeight })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.id, 1))
      .get();
    return row?.tournamentEloDeltaWeight ?? DEFAULT_TOURNAMENT_ELO_DELTA_WEIGHT;
  }

  setTournamentEloDeltaWeight(
    deltaWeight: TournamentEloDeltaWeight,
  ): TournamentEloDeltaWeight {
    const eloWeight = this.getRatingEloWeight();
    this.db
      .insert(schema.appSettings)
      .values({ id: 1, ratingEloWeight: eloWeight, tournamentEloDeltaWeight: deltaWeight })
      .onConflictDoUpdate({
        target: schema.appSettings.id,
        set: { tournamentEloDeltaWeight: deltaWeight },
      })
      .run();
    return deltaWeight;
  }

  recomputeBlendRatings(eloWeight: RatingEloWeight = this.getRatingEloWeight()): void {
    const rows = this.db.select().from(schema.teams).all();
    if (rows.length === 0) return;

    const blended = computeBlendedNormalizedRatings(
      rows.map((row) => ({
        elo: row.elo ?? row.rating,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        total: row.total,
      })),
      eloWeight,
    );

    for (const [index, [offensive, defensive]] of blended.entries()) {
      this.db
        .update(schema.teams)
        .set({
          blendOffensiveRating: offensive,
          blendDefensiveRating: defensive,
        })
        .where(eq(schema.teams.id, rows[index]!.id))
        .run();
    }
  }

  getTournamentEloDeltas(simulationId: number): Map<number, number> {
    const rows = this.db
      .select()
      .from(schema.simulationTeamEloDelta)
      .where(eq(schema.simulationTeamEloDelta.simulationId, simulationId))
      .all();
    return new Map(rows.map((row) => [row.teamId, row.eloDelta]));
  }

  getSimulationRatingsMap(simulationId: number): Map<number, SimulationRatings> {
    const teams = this.getTeams();
    const deltas = this.getTournamentEloDeltas(simulationId);
    return computeSimulationRatings(
      teams,
      deltas,
      this.getRatingEloWeight(),
      this.getTournamentEloDeltaWeight(),
    );
  }

  getTeamForSimulation(simulationId: number, teamId: number): Team {
    const team = this.getTeamByIdOrName(teamId);
    if (!team) {
      throw new Error(`Team not found: ${teamId}`);
    }
    const ratings = this.getSimulationRatingsMap(simulationId).get(team.id);
    return teamForSimulation(team, ratings);
  }

  getTeamsForSimulation(simulationId: number): Team[] {
    const teams = this.getTeams();
    const ratings = this.getSimulationRatingsMap(simulationId);
    return teams.map((team) => teamForSimulation(team, ratings.get(team.id)));
  }

  recomputeTournamentEloDeltas(simulationId: number): void {
    const teams = this.getTeams();
    if (teams.length === 0) return;

    const fixtures = this.getFixtures();
    const matches = this.getSimulationMatches(simulationId);
    const deltas = recomputeEloDeltasFromSimulationState(teams, fixtures, matches);

    this.db
      .delete(schema.simulationTeamEloDelta)
      .where(eq(schema.simulationTeamEloDelta.simulationId, simulationId))
      .run();

    for (const [teamId, eloDelta] of deltas) {
      this.db
        .insert(schema.simulationTeamEloDelta)
        .values({
          simulationId,
          teamId,
          eloDelta,
        })
        .run();
    }
  }

  getFixtures(): Fixture[] {
    return this.db.select().from(schema.fixtures).all().map(mapFixture);
  }

  getGroupMemberships(): GroupMembership[] {
    return this.db
      .select()
      .from(schema.groupMemberships)
      .all()
      .map((r) => ({ groupLetter: r.groupLetter, teamId: r.teamId }));
  }

  listSimulations(): Simulation[] {
    return this.db
      .select()
      .from(schema.simulations)
      .all()
      .map(mapSimulation)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  listSimulationsWithCounts(): SimulationListEntry[] {
    const simulations = this.listSimulations();
    if (simulations.length === 0) return [];

    const rows = this.db
      .select({
        simulationId: schema.simulationMatches.simulationId,
        playedCount: sql<number>`count(*)`,
      })
      .from(schema.simulationMatches)
      .where(eq(schema.simulationMatches.status, 'played'))
      .groupBy(schema.simulationMatches.simulationId)
      .all();

    const playedBySimulationId = new Map(
      rows.map((row) => [row.simulationId, Number(row.playedCount)]),
    );

    return simulations.map((simulation) => ({
      ...simulation,
      playedCount: playedBySimulationId.get(simulation.id) ?? 0,
    }));
  }

  countSimulations(): number {
    const row = this.db.select({ total: count() }).from(schema.simulations).get();
    return Number(row?.total ?? 0);
  }

  listSimulationsWithCountsPage(page: number, pageSize: number): SimulationListPage {
    const total = this.countSimulations();
    if (total === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    const offset = (page - 1) * pageSize;
    const simulations = this.db
      .select()
      .from(schema.simulations)
      .orderBy(desc(schema.simulations.updatedAt))
      .limit(pageSize)
      .offset(offset)
      .all()
      .map(mapSimulation);

    if (simulations.length === 0) {
      return { items: [], total, page, pageSize };
    }

    const simulationIds = simulations.map((simulation) => simulation.id);
    const rows = this.db
      .select({
        simulationId: schema.simulationMatches.simulationId,
        playedCount: sql<number>`count(*)`,
      })
      .from(schema.simulationMatches)
      .where(
        and(
          eq(schema.simulationMatches.status, 'played'),
          inArray(schema.simulationMatches.simulationId, simulationIds),
        ),
      )
      .groupBy(schema.simulationMatches.simulationId)
      .all();

    const playedBySimulationId = new Map(
      rows.map((row) => [row.simulationId, Number(row.playedCount)]),
    );

    return {
      items: simulations.map((simulation) => ({
        ...simulation,
        playedCount: playedBySimulationId.get(simulation.id) ?? 0,
      })),
      total,
      page,
      pageSize,
    };
  }

  listPredictions(): Prediction[] {
    return this.db
      .select()
      .from(schema.predictions)
      .orderBy(desc(schema.predictions.updatedAt))
      .all()
      .map(mapPrediction);
  }

  countSimulationsMatchingSpec(spec: SelectionSpec): number {
    const rows = this.db.select({ id: schema.simulations.id }).from(schema.simulations).all();
    return rows.filter((row) => simulationIdInSpec(row.id, spec)).length;
  }

  validateSelection(selection: string): ValidateSelectionResult | { error: string } {
    const parsed = parseSelectionInput(selection);
    if (!parsed.ok) return { error: parsed.error };
    const matchingIds = this.db
      .select({ id: schema.simulations.id })
      .from(schema.simulations)
      .all()
      .map((row) => row.id)
      .filter((id) => simulationIdInSpec(id, parsed.spec));
    if (matchingIds.length === 0) {
      return { error: 'No simulations match this selection' };
    }
    return {
      count: matchingIds.length,
      minId: Math.min(...matchingIds),
      maxId: Math.max(...matchingIds),
    };
  }

  listPredictionsPage(page: number, pageSize: number): PredictionListPage {
    const total = Number(
      this.db.select({ total: count() }).from(schema.predictions).get()?.total ?? 0,
    );
    const offset = (page - 1) * pageSize;
    const rows = this.db
      .select()
      .from(schema.predictions)
      .orderBy(desc(schema.predictions.updatedAt))
      .limit(pageSize)
      .offset(offset)
      .all()
      .map(mapPrediction);

    return {
      items: rows.map((prediction) => ({
        ...prediction,
        simulationCount: this.countSimulationsMatchingSpec(prediction.selectionSpec),
        selectionLabel: formatSelectionSpec(prediction.selectionSpec),
      })),
      total,
      page,
      pageSize,
    };
  }

  getPrediction(id: number): Prediction | null {
    const row = this.db
      .select()
      .from(schema.predictions)
      .where(eq(schema.predictions.id, id))
      .get();
    return row ? mapPrediction(row) : null;
  }

  getActivePrediction(): Prediction | null {
    const row = this.db
      .select()
      .from(schema.predictions)
      .orderBy(desc(schema.predictions.updatedAt))
      .limit(1)
      .get();
    return row ? mapPrediction(row) : null;
  }

  resolvePredictionId(predictionId?: number): number | null {
    if (predictionId != null) {
      return this.getPrediction(predictionId)?.id ?? null;
    }
    return this.getActivePrediction()?.id ?? this.getPrediction(1)?.id ?? null;
  }

  createPrediction(name: string, selection: string): Prediction {
    const parsed = parseSelectionInput(selection);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const validation = this.validateSelection(selection);
    if ('error' in validation) {
      throw new Error(validation.error);
    }

    const trimmed = name.trim() || 'Prediction';
    const now = new Date().toISOString();
    const row = this.db
      .insert(schema.predictions)
      .values({
        name: trimmed,
        selectionSpec: serializeSelectionSpec(parsed.spec),
        consensusMode: getDefaultConsensusMode(),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    rebuildPredictionAggregates(this.db, row.id, parsed.spec);
    backfillFrozenMatchesForPrediction(this.db, row.id, parsed.spec);
    copyMissingFrozenMatchesFromDefault(this.db, row.id);
    syncCanonicalLockedSampleGoalsFromDefault(this.db, row.id);
    applyCanonicalLockedConsensusFromActuals(this.db, row.id);
    return mapPrediction(row);
  }

  renamePrediction(id: number, name: string): Prediction | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const row = this.db
      .update(schema.predictions)
      .set({ name: trimmed, updatedAt: new Date().toISOString() })
      .where(eq(schema.predictions.id, id))
      .returning()
      .get();
    return row ? mapPrediction(row) : null;
  }

  setPredictionConsensusMode(id: number, mode: Prediction['consensusMode']): Prediction | null {
    const row = this.db
      .update(schema.predictions)
      .set({ consensusMode: mode, updatedAt: new Date().toISOString() })
      .where(eq(schema.predictions.id, id))
      .returning()
      .get();
    if (row) {
      this.invalidatePredictionKnockout(id);
    }
    return row ? mapPrediction(row) : null;
  }

  setFrozenMatchConsensusMode(
    predictionId: number,
    matchNumber: number,
    consensusMode: Prediction['consensusMode'],
  ): MasterGroupState {
    if (!this.getPrediction(predictionId)) {
      throw new FrozenMatchError(`Prediction not found: ${predictionId}`);
    }
    try {
      setFrozenMatchConsensusMode(this.db, predictionId, matchNumber, consensusMode);
    } catch (err) {
      throw new FrozenMatchError(err instanceof Error ? err.message : 'Failed to update frozen match');
    }
    this.invalidatePredictionKnockout(predictionId);
    return this.buildMasterGroupView(predictionId);
  }

  deletePrediction(id: number): boolean {
    const existing = this.getPrediction(id);
    if (!existing) return false;
    deletePredictionSampleResults(this.db, id);
    this.db
      .delete(schema.predictionFrozenMatches)
      .where(eq(schema.predictionFrozenMatches.predictionId, id))
      .run();
    deletePredictionKnockoutData(this.db, id);
    deletePredictionAggregates(this.db, id);
    this.db.delete(schema.predictions).where(eq(schema.predictions.id, id)).run();
    return true;
  }

  performPredictionSample(predictionId: number): MasterGroupState {
    if (!this.getPrediction(predictionId)) {
      throw new PredictionSampleError(`Prediction not found: ${predictionId}`);
    }
    try {
      runPredictionSample(this.db, predictionId);
    } catch (err) {
      if (err instanceof PredictionSampleError) throw err;
      throw new PredictionSampleError(
        err instanceof Error ? err.message : 'Failed to perform prediction sample',
      );
    }
    this.invalidatePredictionKnockout(predictionId);
    return this.buildMasterGroupView(predictionId);
  }

  performPredictionSampleMatch(predictionId: number, matchNumber: number): MasterGroupState {
    if (!this.getPrediction(predictionId)) {
      throw new PredictionSampleError(`Prediction not found: ${predictionId}`);
    }
    try {
      runPredictionSampleMatch(this.db, predictionId, matchNumber);
    } catch (err) {
      if (err instanceof PredictionSampleError) throw err;
      throw new PredictionSampleError(
        err instanceof Error ? err.message : 'Failed to resample fixture',
      );
    }
    this.invalidatePredictionKnockout(predictionId);
    return this.buildMasterGroupView(predictionId);
  }

  touchPrediction(id: number): Prediction | null {
    const row = this.db
      .update(schema.predictions)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(schema.predictions.id, id))
      .returning()
      .get();
    return row ? mapPrediction(row) : null;
  }

  private refreshPredictionsForSimulation(simulationId: number): void {
    if (isKnockoutRunSimulationId(this, simulationId)) return;
    for (const prediction of this.listPredictions()) {
      if (simulationIdInSpec(simulationId, prediction.selectionSpec)) {
        refreshSimulationInPredictionAggregates(this.db, prediction.id, simulationId);
        this.invalidatePredictionKnockout(prediction.id);
      }
    }
  }

  private invalidatePredictionKnockout(predictionId: number): void {
    clearPredictionKnockoutResults(this.db, predictionId);
    clearActiveKnockoutSimulation(this.db, predictionId);
  }

  private invalidateAllPredictionKnockouts(): void {
    for (const prediction of this.listPredictions()) {
      this.invalidatePredictionKnockout(prediction.id);
    }
  }

  private   resyncAllSimulations(): void {
    for (const simulation of this.listSimulations()) {
      this.syncResolvedParticipants(simulation.id, { refreshMasterStats: false });
    }
    this.rebuildAllPredictionAggregates();
  }

  getEnsuredThirdPlaceOrder(standings: TournamentState['groupStandings']): ThirdPlaceOrderEntry[] {
    return ensureActualThirdPlaceOrder(this.db, standings);
  }

  private removeSimulationFromAllPredictions(simulationId: number): void {
    for (const prediction of this.listPredictions()) {
      if (simulationIdInSpec(simulationId, prediction.selectionSpec)) {
        removeSimulationFromPredictionAggregates(this.db, prediction.id, simulationId);
      }
    }
  }

  updateSimulationName(id: number, name: string): Simulation | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const row = this.db
      .update(schema.simulations)
      .set({ name: trimmed, updatedAt: new Date().toISOString() })
      .where(eq(schema.simulations.id, id))
      .returning()
      .get();
    return row ? mapSimulation(row) : null;
  }

  deleteSimulation(id: number): boolean {
    const existing = this.getSimulation(id);
    if (!existing) return false;
    this.removeSimulationFromAllPredictions(id);
    this.db
      .delete(schema.simulationMatches)
      .where(eq(schema.simulationMatches.simulationId, id))
      .run();
    this.db
      .delete(schema.simulationTeamEloDelta)
      .where(eq(schema.simulationTeamEloDelta.simulationId, id))
      .run();
    this.db.delete(schema.simulations).where(eq(schema.simulations.id, id)).run();
    return true;
  }

  ensureDefaultSimulation(): Simulation {
    const existing = this.listSimulations();
    if (existing.length > 0) return existing[0];
    return this.createSimulation('Simulation');
  }

  createSimulation(
    name: string,
    options: { deferMasterStats?: boolean } = {},
  ): Simulation {
    const existingIds = this.db
      .select({ id: schema.simulations.id })
      .from(schema.simulations)
      .all()
      .map((row) => row.id);
    const id = lowestUnusedId(existingIds);
    const now = new Date().toISOString();
    const result = this.db
      .insert(schema.simulations)
      .values({ id, name, phase: 'group', createdAt: now, updatedAt: now })
      .returning()
      .get();
    const fixtures = this.getFixtures();
    for (const f of fixtures) {
      this.db
        .insert(schema.simulationMatches)
        .values({
          simulationId: result.id,
          matchNumber: f.matchNumber,
          teamHomeId: f.teamHomeId,
          teamAwayId: f.teamAwayId,
          status: 'scheduled',
        })
        .run();
    }
    this.applyActualResultsToSimulation(result.id, {
      refreshMasterStats: !options.deferMasterStats,
    });
    return this.getSimulation(result.id)!;
  }

  importCompletedTournament(
    name: string,
    matches: SimulationMatch[],
    options: { deferMasterStats?: boolean } = {},
  ): Simulation {
    const simulation = this.createSimulation(name, { deferMasterStats: options.deferMasterStats });
    const simulationId = simulation.id;

    this.db.transaction((tx) => {
      for (const match of matches) {
        if (this.isMatchLocked(match.matchNumber)) continue;
        tx
          .update(schema.simulationMatches)
          .set({
            goalsHome: match.goalsHome,
            goalsAway: match.goalsAway,
            penGoalsHome: match.penGoalsHome,
            penGoalsAway: match.penGoalsAway,
            winnerTeamId: match.winnerTeamId,
            status: match.status,
          })
          .where(
            and(
              eq(schema.simulationMatches.simulationId, simulationId),
              eq(schema.simulationMatches.matchNumber, match.matchNumber),
            ),
          )
          .run();
      }
    });

    this.syncResolvedParticipants(simulationId, {
      refreshMasterStats: !options.deferMasterStats,
    });
    this.recomputeTournamentEloDeltas(simulationId);
    return this.getSimulation(simulationId)!;
  }

  getActualResults(): ActualMatchResult[] {
    return this.db
      .select()
      .from(schema.actualMatchResults)
      .all()
      .map(mapActualResult)
      .sort((a, b) => a.matchNumber - b.matchNumber);
  }

  getActualResult(matchNumber: number): ActualMatchResult | null {
    const row = this.db
      .select()
      .from(schema.actualMatchResults)
      .where(eq(schema.actualMatchResults.matchNumber, matchNumber))
      .get();
    return row ? mapActualResult(row) : null;
  }

  isMatchLocked(matchNumber: number): boolean {
    return this.getActualResult(matchNumber) != null;
  }

  setActualResult(
    matchNumber: number,
    goalsHome: number,
    goalsAway: number,
    winnerTeamId: number | null,
  ): ActualMatchResult {
    const fixture = this.getFixtures().find((f) => f.matchNumber === matchNumber);
    if (!fixture) {
      throw new ActualResultError(`Match not found: ${matchNumber}`);
    }

    const resolved = this.resolveActualMatch(fixture);
    if (fixture.group == null && (resolved.homeTeam == null || resolved.awayTeam == null)) {
      throw new ActualResultError(
        'Match participants are not yet determined; complete upstream matches first',
      );
    }

    if (
      fixture.group == null &&
      goalsHome === goalsAway &&
      winnerTeamId == null
    ) {
      throw new ActualResultError('Knockout ties require winnerTeamId');
    }

    if (fixture.group == null && goalsHome === goalsAway && winnerTeamId != null) {
      const homeId = resolved.homeTeam!.id;
      const awayId = resolved.awayTeam!.id;
      if (winnerTeamId !== homeId && winnerTeamId !== awayId) {
        throw new ActualResultError('winnerTeamId must be the resolved home or away team');
      }
    }

    if (goalsHome > goalsAway) {
      const derived = resolved.homeTeam?.id ?? null;
      if (winnerTeamId != null && derived != null && winnerTeamId !== derived) {
        throw new ActualResultError('winnerTeamId does not match the goal difference');
      }
      winnerTeamId = derived;
    } else if (goalsAway > goalsHome) {
      const derived = resolved.awayTeam?.id ?? null;
      if (winnerTeamId != null && derived != null && winnerTeamId !== derived) {
        throw new ActualResultError('winnerTeamId does not match the goal difference');
      }
      winnerTeamId = derived;
    } else     if (fixture.group != null) {
      winnerTeamId = null;
    }

    const fixtures = this.getFixtures();
    const actualResults = this.getActualResults();
    if (!canModifyActualResult(matchNumber, actualResults, fixtures)) {
      throw new ActualResultError(
        `Cannot change match ${matchNumber}: later tournament round results exist (clear those first)`,
      );
    }

    const now = new Date().toISOString();
    const existing = this.getActualResult(matchNumber);
    if (existing) {
      this.db
        .update(schema.actualMatchResults)
        .set({ goalsHome, goalsAway, winnerTeamId, recordedAt: now })
        .where(eq(schema.actualMatchResults.matchNumber, matchNumber))
        .run();
    } else {
      const lockedSample = resolveLockedSamplePredictionForEntry(this.db, matchNumber);
      this.db
        .insert(schema.actualMatchResults)
        .values({
          matchNumber,
          goalsHome,
          goalsAway,
          winnerTeamId,
          recordedAt: now,
          predictedGoalsHome: lockedSample?.goalsHome ?? null,
          predictedGoalsAway: lockedSample?.goalsAway ?? null,
        })
        .run();
      freezeMatchForAllPredictions(this.db, matchNumber, now);
    }
    if (fixture.group != null) {
      for (const prediction of this.listPredictions()) {
        this.invalidatePredictionKnockout(prediction.id);
      }
    }
    return this.getActualResult(matchNumber)!;
  }

  clearActualResult(matchNumber: number): void {
    if (!this.getActualResult(matchNumber)) {
      throw new ActualResultError(`No actual result for match ${matchNumber}`);
    }

    const fixtures = this.getFixtures();
    const actualResults = this.getActualResults();
    if (!canClearActualResult(matchNumber, actualResults, fixtures)) {
      throw new ActualResultError(
        `Cannot clear match ${matchNumber}: later tournament round results exist (clear those first)`,
      );
    }

    this.db
      .delete(schema.actualMatchResults)
      .where(eq(schema.actualMatchResults.matchNumber, matchNumber))
      .run();

    clearFrozenMatch(this.db, matchNumber);
    for (const prediction of this.listPredictions()) {
      rebuildPredictionAggregates(this.db, prediction.id, prediction.selectionSpec);
      this.invalidatePredictionKnockout(prediction.id);
    }
  }

  applyActualResultsToSimulation(
    simulationId: number,
    options: { sync?: boolean; refreshMasterStats?: boolean } = {},
  ): void {
    const actuals = this.getActualResults();
    if (actuals.length === 0) return;

    for (const actual of actuals) {
      this.db
        .update(schema.simulationMatches)
        .set({
          goalsHome: actual.goalsHome,
          goalsAway: actual.goalsAway,
          winnerTeamId: actual.winnerTeamId,
          status: 'played',
        })
        .where(
          and(
            eq(schema.simulationMatches.simulationId, simulationId),
            eq(schema.simulationMatches.matchNumber, actual.matchNumber),
          ),
        )
        .run();
    }
    if (options.sync !== false) {
      this.syncResolvedParticipants(simulationId, {
        refreshMasterStats: options.refreshMasterStats,
      });
    } else if (options.refreshMasterStats !== false) {
      this.refreshPredictionsForSimulation(simulationId);
    }
    this.recomputeTournamentEloDeltas(simulationId);
  }

  getTeamByIdOrName(idOrName: number | string): Team | null {
    if (typeof idOrName === 'number' || /^\d+$/.test(String(idOrName))) {
      const id = typeof idOrName === 'number' ? idOrName : parseInt(String(idOrName), 10);
      return this.getTeams().find((t) => t.id === id) ?? null;
    }
    return this.getTeams().find((t) => t.name === idOrName) ?? null;
  }

  simulationExists(id: number): boolean {
    return this.getSimulation(id) != null;
  }

  chooseSimulationForGroupPhase(): number {
    const row = this.db
      .select({ id: schema.simulations.id })
      .from(schema.simulations)
      .where(
        sql`NOT EXISTS (
          SELECT 1 FROM simulation_matches sm
          WHERE sm.simulation_id = ${schema.simulations.id}
            AND sm.status = 'played'
        )`,
      )
      .orderBy(schema.simulations.id)
      .limit(1)
      .get();
    if (row) return row.id;
    return this.createSimulation('Simulation').id;
  }

  chooseKnockoutSimulation(): number | null {
    const phaseRow = this.db
      .select({ id: schema.simulations.id })
      .from(schema.simulations)
      .where(
        and(
          inArray(schema.simulations.phase, [...KNOCKOUT_ELIGIBLE_PHASES]),
          sql`EXISTS (
            SELECT 1 FROM simulation_matches sm
            JOIN fixtures f ON f.match_number = sm.match_number
            WHERE sm.simulation_id = ${schema.simulations.id}
              AND f."group" IS NULL
              AND sm.status = 'scheduled'
          )`,
        ),
      )
      .orderBy(desc(schema.simulations.updatedAt), desc(schema.simulations.id))
      .limit(1)
      .get();
    if (phaseRow) return phaseRow.id;

    const readyRow = this.db
      .select({ id: schema.simulations.id })
      .from(schema.simulations)
      .where(
        sql`NOT EXISTS (
          SELECT 1 FROM fixtures f
          JOIN simulation_matches sm
            ON sm.match_number = f.match_number AND sm.simulation_id = ${schema.simulations.id}
          WHERE f."group" IS NOT NULL AND sm.status != 'played'
        )
        AND EXISTS (
          SELECT 1 FROM simulation_matches sm
          JOIN fixtures f ON f.match_number = sm.match_number
          WHERE sm.simulation_id = ${schema.simulations.id}
            AND f."group" IS NULL
            AND sm.status = 'scheduled'
        )`,
      )
      .orderBy(desc(schema.simulations.updatedAt), desc(schema.simulations.id))
      .limit(1)
      .get();
    return readyRow?.id ?? null;
  }

  getMatchStatus(simulationId: number, matchNumber: number): MatchStatus | null {
    const row = this.db
      .select({ status: schema.simulationMatches.status })
      .from(schema.simulationMatches)
      .where(
        and(
          eq(schema.simulationMatches.simulationId, simulationId),
          eq(schema.simulationMatches.matchNumber, matchNumber),
        ),
      )
      .get();
    return row?.status ?? null;
  }

  persistMatchResult(
    simulationId: number,
    matchNumber: number,
    goalsHome: number,
    goalsAway: number,
    winnerTeamId: number | null,
    options: {
      sync?: boolean;
      penGoalsHome?: number | null;
      penGoalsAway?: number | null;
    } = {},
  ): void {
    if (this.isMatchLocked(matchNumber)) {
      throw new MatchLockedError(matchNumber);
    }
    const penGoalsHome = options.penGoalsHome ?? null;
    const penGoalsAway = options.penGoalsAway ?? null;
    this.db
      .update(schema.simulationMatches)
      .set({
        goalsHome,
        goalsAway,
        penGoalsHome,
        penGoalsAway,
        winnerTeamId,
        status: 'played',
      })
      .where(
        and(
          eq(schema.simulationMatches.simulationId, simulationId),
          eq(schema.simulationMatches.matchNumber, matchNumber),
        ),
      )
      .run();
    this.touchSimulation(simulationId);
    if (options.sync !== false) {
      this.syncResolvedParticipants(simulationId);
    } else {
      this.refreshPredictionsForSimulation(simulationId);
    }
    this.recomputeTournamentEloDeltas(simulationId);
  }

  buildActualResultsView(): {
    actualResults: ActualMatchResult[];
    resolvedMatches: ResolvedMatch[];
    groupStandings: TournamentState['groupStandings'];
    qualifyingThirdGroups: string[];
    thirdPlaceOrder: ThirdPlaceOrderRow[];
    phase: ReturnType<typeof computeActualPhase>;
  } {
    const teams = this.getTeams();
    const teamsById = new Map(teams.map((t) => [t.id, t]));
    const fixtures = this.getFixtures();
    const actualResults = this.getActualResults();
    const actualByMatch = new Map(actualResults.map((r) => [r.matchNumber, r]));
    const memberships = this.getGroupMemberships();
    const matches = this.buildMatchesFromActuals(fixtures, actualByMatch);

    const playedGroup = collectPlayedGroupMatches(fixtures, matches, actualResults);

    const groupStandings = computeAllGroupStandings(memberships, teamsById, playedGroup);
    const thirdPlaceOrderEntries = ensureActualThirdPlaceOrder(this.db, groupStandings);
    const qualifyingThirdGroups = getQualifyingThirdGroupsFromOrder(thirdPlaceOrderEntries);
    const thirdPlaceOrder = buildThirdPlaceOrderRows(groupStandings, thirdPlaceOrderEntries);
    const annex = lookupAnnexC(qualifyingThirdGroups.join(''));
    const ctx = buildSlotContext(groupStandings, fixtures, matches, teamsById, thirdPlaceOrderEntries);

    const resolvedMatches: ResolvedMatch[] = fixtures.map((fixture) => {
      const actual = actualByMatch.get(fixture.matchNumber);
      const { home, away } = resolveMatchTeams(fixture, ctx, teamsById);
      const result: SimulationMatch = {
        simulationId: 0,
        matchNumber: fixture.matchNumber,
        teamHomeId: home?.id ?? fixture.teamHomeId,
        teamAwayId: away?.id ?? fixture.teamAwayId,
        goalsHome: actual?.goalsHome ?? null,
        goalsAway: actual?.goalsAway ?? null,
        penGoalsHome: null,
        penGoalsAway: null,
        winnerTeamId: actual?.winnerTeamId ?? null,
        status: actual ? 'played' : 'scheduled',
      };
      return {
        fixture,
        result,
        homeTeam: home,
        awayTeam: away,
        homeLabel: home ? home.name : fixture.slotHome,
        awayLabel: away ? away.name : fixture.slotAway,
        isLocked: actual != null,
      };
    });

    const phase = computeActualPhase(actualResults, fixtures);

    return {
      actualResults,
      resolvedMatches,
      groupStandings,
      qualifyingThirdGroups,
      thirdPlaceOrder,
      phase,
    };
  }

  private buildMatchesFromActuals(
    fixtures: Fixture[],
    actualByMatch: Map<number, ActualMatchResult>,
  ): SimulationMatch[] {
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
        status: actual ? 'played' : 'scheduled',
      };
    });
  }

  private resolveActualMatch(fixture: Fixture): ResolvedMatch {
    return this.buildActualResultsView().resolvedMatches.find(
      (m) => m.fixture.matchNumber === fixture.matchNumber,
    )!;
  }

  getSimulation(id: number): Simulation | null {
    const row = this.db.select().from(schema.simulations).where(eq(schema.simulations.id, id)).get();
    return row ? mapSimulation(row) : null;
  }

  getLastEditedSimulation(): Simulation | null {
    const row = this.db
      .select()
      .from(schema.simulations)
      .orderBy(desc(schema.simulations.updatedAt))
      .limit(1)
      .get();
    return row ? mapSimulation(row) : null;
  }

  touchSimulation(id: number): void {
    this.db
      .update(schema.simulations)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(schema.simulations.id, id))
      .run();
  }

  getSimulationMatches(simulationId: number): SimulationMatch[] {
    return this.db
      .select()
      .from(schema.simulationMatches)
      .where(eq(schema.simulationMatches.simulationId, simulationId))
      .all()
      .map(mapMatch);
  }

  updateMatchResult(
    simulationId: number,
    matchNumber: number,
    goalsHome: number,
    goalsAway: number,
    winnerTeamId: number | null,
    penGoals?: { penGoalsHome?: number | null; penGoalsAway?: number | null },
  ): void {
    if (this.isMatchLocked(matchNumber)) {
      throw new MatchLockedError(matchNumber);
    }

    const fixtures = this.getFixtures();
    const matches = this.getSimulationMatches(simulationId);
    const locked = new Set(this.getActualResults().map((result) => result.matchNumber));
    if (!canModifySimulationResult(matchNumber, matches, fixtures, locked)) {
      throw new MatchClearBlockedError(matchNumber);
    }

    this.persistMatchResult(simulationId, matchNumber, goalsHome, goalsAway, winnerTeamId, {
      penGoalsHome: penGoals?.penGoalsHome ?? null,
      penGoalsAway: penGoals?.penGoalsAway ?? null,
    });
  }

  clearMatchResult(simulationId: number, matchNumber: number): void {
    if (this.isMatchLocked(matchNumber)) {
      throw new MatchLockedError(matchNumber);
    }

    const fixtures = this.getFixtures();
    const matches = this.getSimulationMatches(simulationId);
    const locked = new Set(this.getActualResults().map((result) => result.matchNumber));
    if (!canClearSimulationResult(matchNumber, matches, fixtures, locked)) {
      throw new MatchClearBlockedError(matchNumber);
    }

    this.db
      .update(schema.simulationMatches)
      .set({
        goalsHome: null,
        goalsAway: null,
        penGoalsHome: null,
        penGoalsAway: null,
        winnerTeamId: null,
        status: 'scheduled',
      })
      .where(
        and(
          eq(schema.simulationMatches.simulationId, simulationId),
          eq(schema.simulationMatches.matchNumber, matchNumber),
        ),
      )
      .run();
    this.syncResolvedParticipants(simulationId);
    this.recomputeTournamentEloDeltas(simulationId);
  }

  syncResolvedParticipants(
    simulationId: number,
    options: { refreshMasterStats?: boolean } = {},
  ): void {
    const simulation = this.getSimulation(simulationId);
    if (!simulation) return;

    const teams = this.getTeams();
    const teamsById = new Map(teams.map((t) => [t.id, t]));
    const fixtures = this.getFixtures();
    const matches = this.getSimulationMatches(simulationId);
    const memberships = this.getGroupMemberships();
    const actualResults = this.getActualResults();

    const playedGroup = collectPlayedGroupMatches(fixtures, matches, actualResults);
    const groupStandings = computeAllGroupStandings(memberships, teamsById, playedGroup);
    const thirdPlaceOrder = ensureActualThirdPlaceOrder(this.db, groupStandings);

    const synced = syncResolvedParticipantsInMemory(
      fixtures,
      matches,
      teamsById,
      memberships,
      actualResults,
      thirdPlaceOrder,
    );

    for (const match of synced.matches) {
      this.db
        .update(schema.simulationMatches)
        .set({
          teamHomeId: match.teamHomeId,
          teamAwayId: match.teamAwayId,
        })
        .where(
          and(
            eq(schema.simulationMatches.simulationId, simulationId),
            eq(schema.simulationMatches.matchNumber, match.matchNumber),
          ),
        )
        .run();
    }

    this.db
      .update(schema.simulations)
      .set({
        phase: synced.phase,
        annexCCombinationId: synced.annexCCombinationId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.simulations.id, simulationId))
      .run();

    if (options.refreshMasterStats !== false) {
      this.refreshPredictionsForSimulation(simulationId);
    }
  }

  rebuildAllPredictionAggregates(): void {
    const predictions = this.listPredictions().map((prediction) => ({
      id: prediction.id,
      selectionSpec: prediction.selectionSpec,
    }));
    rebuildAllPredictionAggregates(this.db, predictions);
  }

  buildMasterGroupView(predictionId: number): MasterGroupState {
    syncCanonicalLockedSampleGoalsFromDefault(this.db, predictionId);
    applyCanonicalLockedConsensusFromActuals(this.db, predictionId);

    const prediction = this.getPrediction(predictionId);
    const consensusMode = prediction?.consensusMode ?? getDefaultConsensusMode();
    const teams = this.getTeams();
    const teamsById = new Map(teams.map((t) => [t.id, t]));
    const fixtures = this.getFixtures();
    const memberships = this.getGroupMemberships();
    const groupFixtures = fixtures.filter((f) => f.group != null);
    const lockedMatchNumbers = new Set(this.getActualResults().map((r) => r.matchNumber));
    const lockedSampleGoals = readLockedMatchSampleGoalsFromActuals(this.db);
    const canonicalSamples = readCanonicalLockedSampleGoals(this.db);

    const { outcomesByMatch, scorelinesByMatch } = readPredictionMatchDistributions(
      this.db,
      predictionId,
    );
    const frozen = readEffectiveFrozenMatchDistributions(this.db, predictionId);
    const sampleResults = readPredictionSampleResults(this.db, predictionId);
    const sampleSummary = readPredictionSampleSummary(this.db, predictionId);

    const consensusMatches: SimulationMatch[] = [];
    const distributions: Record<number, OutcomeDistribution> = {};

    for (const fixture of groupFixtures) {
      const locked = this.isMatchLocked(fixture.matchNumber);
      const frozenOutcomes = locked ? frozen.outcomesByMatch.get(fixture.matchNumber) : undefined;
      const outcomeCounts = frozenOutcomes ??
        outcomesByMatch.get(fixture.matchNumber) ?? {
          homeWin: 0,
          draw: 0,
          awayWin: 0,
          total: 0,
        };
      const matchScorelines = locked
        ? (frozen.scorelinesByMatch.get(fixture.matchNumber) ?? [])
        : (scorelinesByMatch.get(fixture.matchNumber) ?? []);
      const frozenConsensusMode = locked
        ? frozen.consensusModesByMatch.get(fixture.matchNumber)
        : undefined;
      distributions[fixture.matchNumber] = {
        ...outcomeCounts,
        scorelines: matchScorelines,
        ...(frozenConsensusMode ? { consensusMode: frozenConsensusMode } : {}),
      };
      const dist = distributions[fixture.matchNumber];

      const homeTeam =
        fixture.teamHomeId != null ? teamsById.get(fixture.teamHomeId) ?? null : null;
      const awayTeam =
        fixture.teamAwayId != null ? teamsById.get(fixture.teamAwayId) ?? null : null;

      let goalsHome: number | null = null;
      let goalsAway: number | null = null;
      let winnerTeamId: number | null = null;
      let status: MatchStatus = 'scheduled';

      if (homeTeam && awayTeam) {
        const mode = frozenConsensusMode ?? consensusMode;
        const matchLockedSample = lockedSampleGoals.get(fixture.matchNumber);
        const canonicalSample = canonicalSamples.get(fixture.matchNumber);
        const frozenSample = frozen.sampleGoalsByMatch.get(fixture.matchNumber);
        const liveSample = sampleResults.get(fixture.matchNumber);
        const savedSample =
          mode === 'sample' && locked
            ? (matchLockedSample ?? frozenSample ?? canonicalSample)
            : liveSample;
        const canPickScore =
          mode === 'sample' ? savedSample != null : dist.total > 0;
        if (canPickScore) {
          const scoreline = chooseConsensus({
            mode,
            outcomeCounts: dist,
            scorelines: matchScorelines,
            homeOffensive: homeTeam.eloOffensiveRating,
            awayOffensive: awayTeam.eloOffensiveRating,
            savedSample: savedSample
              ? { goalsHome: savedSample.goalsHome, goalsAway: savedSample.goalsAway }
              : null,
          });
          if (scoreline) {
            goalsHome = scoreline.goalsHome;
            goalsAway = scoreline.goalsAway;
            winnerTeamId = winnerFromGoals(
              goalsHome,
              goalsAway,
              fixture.teamHomeId!,
              fixture.teamAwayId!,
            );
            status = 'played';
          }
        }
      }

      consensusMatches.push({
        simulationId: 0,
        matchNumber: fixture.matchNumber,
        teamHomeId: fixture.teamHomeId,
        teamAwayId: fixture.teamAwayId,
        goalsHome,
        goalsAway,
        penGoalsHome: null,
        penGoalsAway: null,
        winnerTeamId,
        status,
      });
    }

    const playedGroup = collectPlayedGroupMatches(fixtures, consensusMatches, this.getActualResults());
    const groupStandings = computeAllGroupStandings(memberships, teamsById, playedGroup);
    const qualifyingThirdGroups = getQualifyingThirdGroups(groupStandings);

    const resolvedMatches: ResolvedMatch[] = groupFixtures.map((fixture) => {
      const result = consensusMatches.find((m) => m.matchNumber === fixture.matchNumber)!;
      const home =
        result.teamHomeId != null ? teamsById.get(result.teamHomeId) ?? null : null;
      const away =
        result.teamAwayId != null ? teamsById.get(result.teamAwayId) ?? null : null;
      return {
        fixture,
        result,
        homeTeam: home,
        awayTeam: away,
        homeLabel: home ? home.name : fixture.slotHome,
        awayLabel: away ? away.name : fixture.slotAway,
        isLocked: this.isMatchLocked(fixture.matchNumber),
      };
    });

    const mergedSampleResults = new Map(sampleResults);
    for (const [matchNumber, goals] of frozen.sampleGoalsByMatch) {
      const existing = mergedSampleResults.get(matchNumber);
      mergedSampleResults.set(matchNumber, {
        goalsHome: goals.goalsHome,
        goalsAway: goals.goalsAway,
        sampledAt: existing?.sampledAt ?? sampleSummary?.sampledAt ?? '',
      });
    }
    if (consensusMode === 'sample') {
      for (const matchNumber of lockedMatchNumbers) {
        const frozenMode = frozen.consensusModesByMatch.get(matchNumber);
        if (frozenMode != null && frozenMode !== 'sample') continue;
        const lockedSample =
          lockedSampleGoals.get(matchNumber) ??
          frozen.sampleGoalsByMatch.get(matchNumber) ??
          canonicalSamples.get(matchNumber);
        if (!lockedSample) continue;
        const existing = mergedSampleResults.get(matchNumber);
        mergedSampleResults.set(matchNumber, {
          goalsHome: lockedSample.goalsHome,
          goalsAway: lockedSample.goalsAway,
          sampledAt: existing?.sampledAt ?? sampleSummary?.sampledAt ?? '',
        });
      }
    }

    return {
      consensusMode,
      resolvedMatches,
      groupStandings,
      qualifyingThirdGroups,
      distributions,
      sample: sampleSummary,
      sampleResults: Object.fromEntries(
        [...mergedSampleResults.entries()].map(([matchNumber, row]) => [
          matchNumber,
          { goalsHome: row.goalsHome, goalsAway: row.goalsAway },
        ]),
      ),
    };
  }

  buildMasterTeamStats(predictionId: number): MasterTeamStats {
    const prediction = this.getPrediction(predictionId);
    if (!prediction) {
      return { simulationCount: 0, teams: [] };
    }
    return readPredictionTeamStats(
      this.db,
      predictionId,
      prediction.selectionSpec,
      this.getTeams(),
    );
  }

  buildTournamentState(simulationId: number): TournamentState | null {
    if (!this.getSimulation(simulationId)) return null;

    this.syncResolvedParticipants(simulationId);

    const simulationRow = this.getSimulation(simulationId)!;
    const locked = new Set(this.getActualResults().map((r) => r.matchNumber));
    const matches = this.getSimulationMatches(simulationId);
    const fixtures = this.getFixtures();
    const memberships = this.getGroupMemberships();
    const teams = this.getTeams();
    const actualResults = this.getActualResults();
    const teamsById = new Map(teams.map((t) => [t.id, t]));
    const playedGroup = collectPlayedGroupMatches(fixtures, matches, actualResults);
    const groupStandings = computeAllGroupStandings(memberships, teamsById, playedGroup);
    const thirdPlaceOrder = ensureActualThirdPlaceOrder(this.db, groupStandings);

    const raw = buildTournamentStateFromData({
      simulation: simulationRow,
      teams,
      fixtures,
      matches,
      groupMemberships: memberships,
      actualResults,
      lockedMatchNumbers: locked,
      thirdPlaceOrder,
    });

    return {
      ...raw,
      teams: raw.teams,
      matches: raw.matches.map((m) => ({ ...m, simulationId })),
    };
  }

  predictionHasKnockoutResults(predictionId: number): boolean {
    return hasPredictionKnockoutResults(this.db, predictionId);
  }

  clearPredictionKnockout(predictionId: number): MasterKnockoutState {
    if (!this.getPrediction(predictionId)) {
      throw new Error(`Prediction not found: ${predictionId}`);
    }
    this.invalidatePredictionKnockout(predictionId);
    return this.buildMasterKnockoutView(predictionId);
  }

  setActualThirdPlaceOrder(order: ThirdPlaceOrderEntry[]) {
    const view = this.buildActualResultsView();
    const validGroups = new Set(view.groupStandings.map((group) => group.groupLetter));
    if (order.length !== validGroups.size) {
      throw new Error(`Third-place order must include all ${validGroups.size} groups`);
    }
    const positions = new Set(order.map((entry) => entry.position));
    if (positions.size !== order.length) {
      throw new Error('Third-place order positions must be unique');
    }
    for (const entry of order) {
      if (!validGroups.has(entry.groupLetter)) {
        throw new Error(`Unknown group letter: ${entry.groupLetter}`);
      }
    }
    validateThirdPlaceOrder(order, view.groupStandings);
    writeActualThirdPlaceOrder(this.db, order);
    this.invalidateAllPredictionKnockouts();
    this.resyncAllSimulations();
    return this.buildActualResultsView();
  }

  simulatePredictionKnockoutRoundForPrediction(
    predictionId: number,
    roundName: string,
    options: {
      count?: number;
      upsetVariance?: number;
      ratingEloWeight?: number;
      tournamentEloDeltaWeight?: number;
      resimulate?: boolean;
    } = {},
  ): MasterKnockoutState {
    if (!this.getPrediction(predictionId)) {
      throw new Error(`Prediction not found: ${predictionId}`);
    }

    const masterGroup = this.buildMasterGroupView(predictionId);
    const prediction = this.getPrediction(predictionId)!;
    const teams = this.getTeams();
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const fixtures = this.getFixtures();
    const groupMatches = masterGroup.resolvedMatches.filter((match) => match.fixture.group != null);
    const groupStageComplete = isGroupStageCompleteForPrediction(
      groupMatches.map((match) => match.result),
    );
    if (!groupStageComplete) {
      throw new Error('Group stage is not complete for this prediction');
    }

    const thirdPlaceOrder = ensureActualThirdPlaceOrder(
      this.db,
      masterGroup.groupStandings,
    );
    let knockoutResults = readPredictionKnockoutResults(this.db, predictionId);
    let { ctx } = buildPredictionSlotContext(
      masterGroup.groupStandings,
      thirdPlaceOrder,
      fixtures,
      knockoutResults,
      teamsById,
    );

    const rounds = computeKnockoutRoundAvailability(
      fixtures,
      ctx,
      teamsById,
      knockoutResults,
      groupStageComplete,
    );
    const round = rounds.find((entry) => entry.name === roundName);
    if (!round) {
      throw new RangeError(`Unknown knockout round: ${roundName}`);
    }

    const resimulateCheck = canResimulateKnockoutRound(
      fixtures,
      ctx,
      teamsById,
      knockoutResults,
      groupStageComplete,
      roundName,
    );

    if (round.isComplete) {
      if (!options.resimulate) {
        throw new Error(round.disabledReason ?? 'Round already simulated');
      }
      if (!resimulateCheck.allowed) {
        throw new Error(resimulateCheck.disabledReason ?? 'Round cannot be re-simulated');
      }
      clearKnockoutResultsFromRoundOnward(this.db, predictionId, roundName);
      knockoutResults = readPredictionKnockoutResults(this.db, predictionId);
      const rebuilt = buildPredictionSlotContext(
        masterGroup.groupStandings,
        thirdPlaceOrder,
        fixtures,
        knockoutResults,
        teamsById,
      );
      ctx = rebuilt.ctx;
    } else if (!round.canSimulate) {
      throw new Error(round.disabledReason ?? 'Round cannot be simulated');
    }

    const eloWeight = options.ratingEloWeight ?? this.getRatingEloWeight();
    const deltaWeight = options.tournamentEloDeltaWeight ?? this.getTournamentEloDeltaWeight();
    const ratingsByTeamId = buildPredictionKnockoutRatings(
      teams,
      fixtures,
      ctx,
      teamsById,
      groupMatches.map((match) => ({ fixture: match.fixture, result: match.result })),
      knockoutResults,
      eloWeight,
      deltaWeight,
    );

    const results = simulatePredictionKnockoutRound(
      roundName,
      fixtures,
      ctx,
      teamsById,
      prediction.consensusMode,
      { ...options, ratingsByTeamId },
    );

    writePredictionKnockoutRound(
      this.db,
      predictionId,
      results.map((result) => ({
        matchNumber: result.matchNumber,
        goalsHome: result.goalsHome,
        goalsAway: result.goalsAway,
        winnerTeamId: result.winnerTeamId!,
        penGoalsHome: result.penGoalsHome ?? null,
        penGoalsAway: result.penGoalsAway ?? null,
        distribution: result.distribution,
      })),
    );
    createPredictionKnockoutRun(this.db, this, predictionId);

    return this.buildMasterKnockoutView(predictionId);
  }

  resimulatePredictionKnockoutMatchForPrediction(
    predictionId: number,
    matchNumber: number,
    options: {
      count?: number;
      upsetVariance?: number;
      ratingEloWeight?: number;
      tournamentEloDeltaWeight?: number;
    } = {},
  ): MasterKnockoutState {
    if (!this.getPrediction(predictionId)) {
      throw new Error(`Prediction not found: ${predictionId}`);
    }

    const roundName = findKnockoutRoundNameForMatch(matchNumber);
    if (!roundName) {
      throw new RangeError(`Not a knockout match: ${matchNumber}`);
    }

    const masterGroup = this.buildMasterGroupView(predictionId);
    const prediction = this.getPrediction(predictionId)!;
    const teams = this.getTeams();
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const fixtures = this.getFixtures();
    const groupMatches = masterGroup.resolvedMatches.filter((match) => match.fixture.group != null);
    const groupStageComplete = isGroupStageCompleteForPrediction(
      groupMatches.map((match) => match.result),
    );

    const thirdPlaceOrder = ensureActualThirdPlaceOrder(
      this.db,
      masterGroup.groupStandings,
    );
    let knockoutResults = readPredictionKnockoutResults(this.db, predictionId);
    let { ctx } = buildPredictionSlotContext(
      masterGroup.groupStandings,
      thirdPlaceOrder,
      fixtures,
      knockoutResults,
      teamsById,
    );

    const resimulateCheck = canResimulateKnockoutMatch(
      matchNumber,
      fixtures,
      ctx,
      teamsById,
      knockoutResults,
      groupStageComplete,
      (lockedMatchNumber) => this.isMatchLocked(lockedMatchNumber),
    );
    if (!resimulateCheck.allowed) {
      throw new Error(resimulateCheck.disabledReason ?? 'Match cannot be re-simulated');
    }

    if (resimulateCheck.clearsLaterRounds) {
      clearKnockoutResultsAfterRound(this.db, predictionId, roundName);
      knockoutResults = readPredictionKnockoutResults(this.db, predictionId);
      const rebuilt = buildPredictionSlotContext(
        masterGroup.groupStandings,
        thirdPlaceOrder,
        fixtures,
        knockoutResults,
        teamsById,
      );
      ctx = rebuilt.ctx;
    }

    const fixture = fixtures.find((entry) => entry.matchNumber === matchNumber);
    if (!fixture) {
      throw new RangeError(`Unknown match: ${matchNumber}`);
    }
    const { home, away } = resolveMatchTeams(fixture, ctx, teamsById);
    if (!home || !away) {
      throw new Error(`Unresolved participants for match ${matchNumber}`);
    }

    const eloWeight = options.ratingEloWeight ?? this.getRatingEloWeight();
    const deltaWeight = options.tournamentEloDeltaWeight ?? this.getTournamentEloDeltaWeight();
    const ratingsByTeamId = buildPredictionKnockoutRatings(
      teams,
      fixtures,
      ctx,
      teamsById,
      groupMatches.map((match) => ({ fixture: match.fixture, result: match.result })),
      knockoutResults,
      eloWeight,
      deltaWeight,
    );

    const simulated = simulatePredictionKnockoutMatch(
      ratedTeam(home, ratingsByTeamId),
      ratedTeam(away, ratingsByTeamId),
      prediction.consensusMode,
      options,
    );

    writePredictionKnockoutRound(this.db, predictionId, [
      {
        matchNumber,
        goalsHome: simulated.goalsHome,
        goalsAway: simulated.goalsAway,
        winnerTeamId: simulated.winnerTeamId!,
        penGoalsHome: simulated.penGoalsHome ?? null,
        penGoalsAway: simulated.penGoalsAway ?? null,
        distribution: simulated.distribution,
      },
    ]);
    createPredictionKnockoutRun(this.db, this, predictionId);

    return this.buildMasterKnockoutView(predictionId);
  }

  setPredictionActiveKnockoutSimulation(
    predictionId: number,
    simulationId: number | null,
  ): MasterKnockoutState {
    if (!this.getPrediction(predictionId)) {
      throw new Error(`Prediction not found: ${predictionId}`);
    }
    setActiveKnockoutSimulation(this.db, this, predictionId, simulationId);
    return this.buildMasterKnockoutView(predictionId);
  }

  buildMasterKnockoutView(predictionId: number): MasterKnockoutState {
    ensureKnockoutRunForPrediction(this.db, this, predictionId);

    const masterGroup = this.buildMasterGroupView(predictionId);
    const teams = this.getTeams();
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const fixtures = this.getFixtures();
    const knockoutFixtures = fixtures.filter((fixture) => fixture.group == null);
    const actualResults = this.getActualResults();
    const actualByMatch = new Map(actualResults.map((result) => [result.matchNumber, result]));

    const groupMatches = masterGroup.resolvedMatches.filter((match) => match.fixture.group != null);
    const groupStageComplete = isGroupStageCompleteForPrediction(
      groupMatches.map((match) => match.result),
    );

    const thirdPlaceOrderEntries = ensureActualThirdPlaceOrder(
      this.db,
      masterGroup.groupStandings,
    );
    const qualifyingThirdGroups = getQualifyingThirdGroupsFromOrder(thirdPlaceOrderEntries);

    const thirdPlaceOrder: ThirdPlaceOrderRow[] = buildThirdPlaceOrderRows(
      masterGroup.groupStandings,
      thirdPlaceOrderEntries,
    );

    const prediction = this.getPrediction(predictionId)!;
    const consensusKnockoutResults = readPredictionKnockoutResults(this.db, predictionId);
    const pathKnockoutResults =
      prediction.activeKnockoutSimulationId != null
        ? readKnockoutResultsFromSimulation(this, prediction.activeKnockoutSimulationId)
        : consensusKnockoutResults;

    const { ctx, annexCCombinationId } = buildPredictionSlotContext(
      masterGroup.groupStandings,
      thirdPlaceOrderEntries,
      fixtures,
      pathKnockoutResults,
      teamsById,
    );

    const rounds = computeKnockoutRoundAvailability(
      fixtures,
      ctx,
      teamsById,
      pathKnockoutResults,
      groupStageComplete,
    );

    const knockoutResultByMatch = new Map(
      pathKnockoutResults.map((result) => [result.matchNumber, result]),
    );

    const distributions: Record<number, OutcomeDistribution> = {};
    for (const result of consensusKnockoutResults) {
      if (!result.distribution || result.distribution.total <= 0) continue;
      distributions[result.matchNumber] = {
        ...result.distribution,
        consensusMode: prediction.consensusMode,
      };
    }

    const resolvedMatches: ResolvedMatch[] = knockoutFixtures.map((fixture) => {
      const { home, away } = resolveMatchTeams(fixture, ctx, teamsById);
      const persisted = knockoutResultByMatch.get(fixture.matchNumber);
      const actual = actualByMatch.get(fixture.matchNumber);
      const isLocked = this.isMatchLocked(fixture.matchNumber);

      let result: SimulationMatch;
      if (persisted) {
        result = {
          simulationId: 0,
          matchNumber: fixture.matchNumber,
          teamHomeId: home?.id ?? null,
          teamAwayId: away?.id ?? null,
          goalsHome: persisted.goalsHome,
          goalsAway: persisted.goalsAway,
          penGoalsHome: persisted.penGoalsHome,
          penGoalsAway: persisted.penGoalsAway,
          winnerTeamId: persisted.winnerTeamId,
          status: 'played',
        };
      } else if (actual) {
        result = {
          simulationId: 0,
          matchNumber: fixture.matchNumber,
          teamHomeId: home?.id ?? fixture.teamHomeId,
          teamAwayId: away?.id ?? fixture.teamAwayId,
          goalsHome: actual.goalsHome,
          goalsAway: actual.goalsAway,
          penGoalsHome: null,
          penGoalsAway: null,
          winnerTeamId: actual.winnerTeamId,
          status: 'played',
        };
      } else {
        result = {
          simulationId: 0,
          matchNumber: fixture.matchNumber,
          teamHomeId: home?.id ?? null,
          teamAwayId: away?.id ?? null,
          goalsHome: null,
          goalsAway: null,
          penGoalsHome: null,
          penGoalsAway: null,
          winnerTeamId: null,
          status: 'scheduled',
        };
      }

      return {
        fixture,
        result,
        homeTeam: home,
        awayTeam: away,
        homeLabel: home ? home.name : fixture.slotHome,
        awayLabel: away ? away.name : fixture.slotAway,
        isLocked,
      };
    });

    return {
      consensusMode: masterGroup.consensusMode,
      resolvedMatches,
      thirdPlaceOrder,
      qualifyingThirdGroups,
      annexCCombinationId,
      distributions,
      rounds: rounds.map((round) => ({
        name: round.name,
        label: round.label,
        matches: [...round.matches],
        canSimulate: round.canSimulate,
        isComplete: round.isComplete,
        disabledReason: round.disabledReason,
      })),
      hasKnockoutResults: pathKnockoutResults.length > 0,
      groupStageComplete,
      activeKnockoutSimulationId: prediction.activeKnockoutSimulationId,
      knockoutRuns: listKnockoutRunsForPrediction(this, predictionId),
    };
  }
}
