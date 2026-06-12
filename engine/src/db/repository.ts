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
  MasterTeamStats,
  OutcomeDistribution,
} from '../engine/types.js';
import { chooseConsensus, getConsensusMode } from '../engine/consensus.js';
import { winnerFromGoals } from '../engine/matchSimulator.js';
import { MatchLockedError, MatchClearBlockedError, ActualResultError } from './errors.js';
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
  readMasterTeamStats,
  rebuildAllMasterTeamStats,
  refreshSimulationTeamGoals,
  removeSimulationFromMasterStats,
} from './masterTeamStats.js';
import {
  readMasterMatchDistributions,
  rebuildAllMasterMatchAggregates,
  refreshSimulationGroupMatchAggregates,
  removeSimulationFromMasterMatchAggregates,
} from './masterMatchAggregates.js';

function mapTeam(row: typeof schema.teams.$inferSelect): Team {
  return {
    id: row.id,
    name: row.name,
    countryCode: row.countryCode,
    flag: row.flag,
    rank: row.rank,
    rating: row.rating,
    total: row.total,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    offensiveRating: row.offensiveRating,
    defensiveRating: row.defensiveRating,
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

  updateTeamRatings(
    teamId: number,
    offensiveRating: number,
    defensiveRating: number,
  ): Team | null {
    if (
      !Number.isFinite(offensiveRating) ||
      !Number.isFinite(defensiveRating) ||
      offensiveRating < 0 ||
      defensiveRating < 0
    ) {
      return null;
    }
    const row = this.db
      .update(schema.teams)
      .set({ offensiveRating, defensiveRating })
      .where(eq(schema.teams.id, teamId))
      .returning()
      .get();
    return row ? mapTeam(row) : null;
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
    removeSimulationFromMasterStats(this.db, id);
    removeSimulationFromMasterMatchAggregates(this.db, id);
    this.db
      .delete(schema.simulationMatches)
      .where(eq(schema.simulationMatches.simulationId, id))
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
      this.db
        .insert(schema.actualMatchResults)
        .values({ matchNumber, goalsHome, goalsAway, winnerTeamId, recordedAt: now })
        .run();
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
      refreshSimulationTeamGoals(this.db, simulationId);
      refreshSimulationGroupMatchAggregates(this.db, simulationId);
    }
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
    options: { sync?: boolean } = {},
  ): void {
    if (this.isMatchLocked(matchNumber)) {
      throw new MatchLockedError(matchNumber);
    }
    this.db
      .update(schema.simulationMatches)
      .set({
        goalsHome,
        goalsAway,
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
      refreshSimulationTeamGoals(this.db, simulationId);
      refreshSimulationGroupMatchAggregates(this.db, simulationId);
    }
  }

  buildActualResultsView(): {
    actualResults: ActualMatchResult[];
    resolvedMatches: ResolvedMatch[];
    groupStandings: TournamentState['groupStandings'];
    qualifyingThirdGroups: string[];
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
    const qualifyingThirdGroups = getQualifyingThirdGroups(groupStandings);
    const annex = lookupAnnexC(getQualifyingThirdGroupsKey(groupStandings));
    const ctx = buildSlotContext(groupStandings, fixtures, matches, teamsById, annex?.id ?? null);

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

    return { actualResults, resolvedMatches, groupStandings, qualifyingThirdGroups, phase };
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

    this.persistMatchResult(simulationId, matchNumber, goalsHome, goalsAway, winnerTeamId);
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

    const synced = syncResolvedParticipantsInMemory(
      fixtures,
      matches,
      teamsById,
      memberships,
      actualResults,
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
      refreshSimulationTeamGoals(this.db, simulationId);
      refreshSimulationGroupMatchAggregates(this.db, simulationId);
    }
  }

  rebuildAllMasterTeamStats(): void {
    rebuildAllMasterTeamStats(this.db);
  }

  rebuildAllMasterMatchAggregates(): void {
    rebuildAllMasterMatchAggregates(this.db);
  }

  rebuildAllMasterAggregates(): void {
    rebuildAllMasterTeamStats(this.db);
    rebuildAllMasterMatchAggregates(this.db);
  }

  buildMasterGroupView(): MasterGroupState {
    const teams = this.getTeams();
    const teamsById = new Map(teams.map((t) => [t.id, t]));
    const fixtures = this.getFixtures();
    const memberships = this.getGroupMemberships();
    const groupFixtures = fixtures.filter((f) => f.group != null);

    const { outcomesByMatch, scorelinesByMatch } = readMasterMatchDistributions(this.db);

    const consensusMatches: SimulationMatch[] = [];
    const distributions: Record<number, OutcomeDistribution> = {};

    for (const fixture of groupFixtures) {
      const outcomeCounts = outcomesByMatch.get(fixture.matchNumber) ?? {
        homeWin: 0,
        draw: 0,
        awayWin: 0,
        total: 0,
      };
      distributions[fixture.matchNumber] = {
        ...outcomeCounts,
        scorelines: scorelinesByMatch.get(fixture.matchNumber) ?? [],
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

      if (dist.total > 0 && homeTeam && awayTeam) {
        const scoreline = chooseConsensus({
          outcomeCounts: dist,
          scorelines: scorelinesByMatch.get(fixture.matchNumber) ?? [],
          homeOffensive: homeTeam.offensiveRating,
          awayOffensive: awayTeam.offensiveRating,
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

      consensusMatches.push({
        simulationId: 0,
        matchNumber: fixture.matchNumber,
        teamHomeId: fixture.teamHomeId,
        teamAwayId: fixture.teamAwayId,
        goalsHome,
        goalsAway,
        winnerTeamId,
        status,
      });
    }

    const playedGroup = collectPlayedGroupMatches(fixtures, consensusMatches, []);
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

    return {
      consensusMode: getConsensusMode(),
      resolvedMatches,
      groupStandings,
      qualifyingThirdGroups,
      distributions,
    };
  }

  buildMasterTeamStats(): MasterTeamStats {
    return readMasterTeamStats(this.db, this.getTeams());
  }

  buildTournamentState(simulationId: number): TournamentState | null {
    if (!this.getSimulation(simulationId)) return null;

    this.syncResolvedParticipants(simulationId);

    const simulationRow = this.getSimulation(simulationId)!;
    const locked = new Set(this.getActualResults().map((r) => r.matchNumber));

    const raw = buildTournamentStateFromData({
      simulation: simulationRow,
      teams: this.getTeams(),
      fixtures: this.getFixtures(),
      matches: this.getSimulationMatches(simulationId),
      groupMemberships: this.getGroupMemberships(),
      actualResults: this.getActualResults(),
      lockedMatchNumbers: locked,
    });

    return {
      ...raw,
      teams: raw.teams,
      matches: raw.matches.map((m) => ({ ...m, simulationId })),
    };
  }
}
