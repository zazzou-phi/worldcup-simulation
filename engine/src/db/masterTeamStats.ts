import type Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import * as schema from './schema.js';
import type { MasterTeamStats, MasterTeamStatsRow, Team } from '../engine/types.js';
import { FINAL_MATCH_NUMBER } from '../engine/simulationRounds.js';

function getSqlite(db: Db): Database.Database {
  const client = (db as { $client?: Database.Database }).$client;
  if (!client) {
    throw new Error('SQLite client required for master team stats rebuild');
  }
  return client;
}

function adjustMasterTeamStats(
  db: Db,
  teamId: number,
  goalsDelta: number,
  simulationsDelta: number,
  championDelta: number,
): void {
  if (goalsDelta === 0 && simulationsDelta === 0 && championDelta === 0) return;

  const existing = db
    .select()
    .from(schema.masterTeamStats)
    .where(eq(schema.masterTeamStats.teamId, teamId))
    .get();

  const totalGoals = (existing?.totalGoals ?? 0) + goalsDelta;
  const simulationsWithMatches = (existing?.simulationsWithMatches ?? 0) + simulationsDelta;
  const championWins = (existing?.championWins ?? 0) + championDelta;

  if (totalGoals === 0 && simulationsWithMatches === 0 && championWins === 0) {
    if (existing) {
      db.delete(schema.masterTeamStats).where(eq(schema.masterTeamStats.teamId, teamId)).run();
    }
    return;
  }

  if (existing) {
    db.update(schema.masterTeamStats)
      .set({ totalGoals, simulationsWithMatches, championWins })
      .where(eq(schema.masterTeamStats.teamId, teamId))
      .run();
  } else {
    db.insert(schema.masterTeamStats)
      .values({ teamId, totalGoals, simulationsWithMatches, championWins })
      .run();
  }
}

export function refreshSimulationTeamGoals(db: Db, simulationId: number): void {
  const oldRows = db
    .select()
    .from(schema.simulationTeamGoals)
    .where(eq(schema.simulationTeamGoals.simulationId, simulationId))
    .all();
  const oldGoalsByTeam = new Map(oldRows.map((row) => [row.teamId, row.goals]));

  const matches = db
    .select()
    .from(schema.simulationMatches)
    .where(eq(schema.simulationMatches.simulationId, simulationId))
    .all();

  const newGoalsByTeam = new Map<number, number>();
  for (const match of matches) {
    if (match.status !== 'played') continue;
    if (match.teamHomeId != null && match.goalsHome != null) {
      newGoalsByTeam.set(
        match.teamHomeId,
        (newGoalsByTeam.get(match.teamHomeId) ?? 0) + match.goalsHome,
      );
    }
    if (match.teamAwayId != null && match.goalsAway != null) {
      newGoalsByTeam.set(
        match.teamAwayId,
        (newGoalsByTeam.get(match.teamAwayId) ?? 0) + match.goalsAway,
      );
    }
  }

  const affectedTeamIds = new Set([...oldGoalsByTeam.keys(), ...newGoalsByTeam.keys()]);
  for (const teamId of affectedTeamIds) {
    const oldGoals = oldGoalsByTeam.get(teamId) ?? 0;
    const newGoals = newGoalsByTeam.get(teamId) ?? 0;
    const hadMatches = oldGoals > 0;
    const hasMatches = newGoals > 0;
    adjustMasterTeamStats(
      db,
      teamId,
      newGoals - oldGoals,
      (hasMatches ? 1 : 0) - (hadMatches ? 1 : 0),
      0,
    );
  }

  db.delete(schema.simulationTeamGoals)
    .where(eq(schema.simulationTeamGoals.simulationId, simulationId))
    .run();
  for (const [teamId, goals] of newGoalsByTeam) {
    if (goals <= 0) continue;
    db.insert(schema.simulationTeamGoals)
      .values({ simulationId, teamId, goals })
      .run();
  }

  const simulation = db
    .select({ championTeamId: schema.simulations.championTeamId })
    .from(schema.simulations)
    .where(eq(schema.simulations.id, simulationId))
    .get();
  const oldChampion = simulation?.championTeamId ?? null;
  const finalMatch = matches.find((match) => match.matchNumber === FINAL_MATCH_NUMBER);
  const newChampion =
    finalMatch?.status === 'played' ? (finalMatch.winnerTeamId ?? null) : null;

  if (oldChampion !== newChampion) {
    if (oldChampion != null) adjustMasterTeamStats(db, oldChampion, 0, 0, -1);
    if (newChampion != null) adjustMasterTeamStats(db, newChampion, 0, 0, 1);
    db.update(schema.simulations)
      .set({ championTeamId: newChampion })
      .where(eq(schema.simulations.id, simulationId))
      .run();
  }
}

export function removeSimulationFromMasterStats(db: Db, simulationId: number): void {
  const goalRows = db
    .select()
    .from(schema.simulationTeamGoals)
    .where(eq(schema.simulationTeamGoals.simulationId, simulationId))
    .all();
  for (const row of goalRows) {
    adjustMasterTeamStats(db, row.teamId, -row.goals, -1, 0);
  }

  const simulation = db
    .select({ championTeamId: schema.simulations.championTeamId })
    .from(schema.simulations)
    .where(eq(schema.simulations.id, simulationId))
    .get();
  if (simulation?.championTeamId != null) {
    adjustMasterTeamStats(db, simulation.championTeamId, 0, 0, -1);
  }

  db.delete(schema.simulationTeamGoals)
    .where(eq(schema.simulationTeamGoals.simulationId, simulationId))
    .run();
}

export function rebuildAllMasterTeamStats(db: Db): void {
  getSqlite(db).exec(`
    DELETE FROM simulation_team_goals;
    DELETE FROM master_team_stats;

    INSERT INTO simulation_team_goals (simulation_id, team_id, goals)
    SELECT simulation_id, team_id, SUM(goals)
    FROM (
      SELECT simulation_id, team_home_id AS team_id, goals_home AS goals
      FROM simulation_matches
      WHERE status = 'played'
        AND team_home_id IS NOT NULL
        AND goals_home IS NOT NULL
      UNION ALL
      SELECT simulation_id, team_away_id AS team_id, goals_away AS goals
      FROM simulation_matches
      WHERE status = 'played'
        AND team_away_id IS NOT NULL
        AND goals_away IS NOT NULL
    )
    GROUP BY simulation_id, team_id;

    INSERT INTO master_team_stats (team_id, total_goals, simulations_with_matches, champion_wins)
    SELECT
      all_teams.team_id,
      COALESCE(goal_stats.total_goals, 0),
      COALESCE(goal_stats.simulations_with_matches, 0),
      COALESCE(champion_stats.champion_wins, 0)
    FROM (
      SELECT team_id FROM simulation_team_goals
      UNION
      SELECT winner_team_id
      FROM simulation_matches
      WHERE match_number = ${FINAL_MATCH_NUMBER}
        AND status = 'played'
        AND winner_team_id IS NOT NULL
    ) AS all_teams
    LEFT JOIN (
      SELECT
        team_id,
        SUM(goals) AS total_goals,
        COUNT(*) AS simulations_with_matches
      FROM simulation_team_goals
      GROUP BY team_id
    ) goal_stats ON goal_stats.team_id = all_teams.team_id
    LEFT JOIN (
      SELECT winner_team_id AS team_id, COUNT(*) AS champion_wins
      FROM simulation_matches
      WHERE match_number = ${FINAL_MATCH_NUMBER}
        AND status = 'played'
        AND winner_team_id IS NOT NULL
      GROUP BY winner_team_id
    ) champion_stats ON champion_stats.team_id = all_teams.team_id;

    UPDATE simulations
    SET champion_team_id = (
      SELECT winner_team_id
      FROM simulation_matches sm
      WHERE sm.simulation_id = simulations.id
        AND sm.match_number = ${FINAL_MATCH_NUMBER}
        AND sm.status = 'played'
    );
  `);
}

export function readMasterTeamStats(db: Db, teams: Team[]): MasterTeamStats {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const simulationCount = db.select({ n: sql<number>`count(*)` }).from(schema.simulations).get();
  const rows = db.select().from(schema.masterTeamStats).all();

  const teamStats: MasterTeamStatsRow[] = rows
    .map((row) => {
      const team = teamsById.get(row.teamId);
      if (!team) return null;
      return {
        teamId: row.teamId,
        teamName: team.name,
        countryCode: team.countryCode,
        flag: team.flag,
        totalGoals: row.totalGoals,
        simulationsWithMatches: row.simulationsWithMatches,
        avgGoalsPerSimulation:
          row.simulationsWithMatches > 0 ? row.totalGoals / row.simulationsWithMatches : 0,
        championWins: row.championWins,
      };
    })
    .filter((row): row is MasterTeamStatsRow => row != null)
    .sort(
      (a, b) =>
        b.avgGoalsPerSimulation - a.avgGoalsPerSimulation ||
        b.championWins - a.championWins ||
        b.totalGoals - a.totalGoals ||
        a.teamName.localeCompare(b.teamName),
    );

  return { simulationCount: Number(simulationCount?.n ?? 0), teams: teamStats };
}
