import type Database from 'better-sqlite3';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import * as schema from './schema.js';
import type { MasterTeamStats, MasterTeamStatsRow, Team } from '../engine/types.js';
import {
  buildSimulationIdSqlFilter,
  type SelectionSpec,
} from '../lib/simulationSelection.js';
import { FINAL_MATCH_NUMBER } from '../engine/simulationRounds.js';
import { KNOCKOUT_SNAPSHOT_SIMULATION_SQL } from './predictionKnockoutSnapshot.js';

export interface PredictionMatchOutcomeCounts {
  homeWin: number;
  draw: number;
  awayWin: number;
  total: number;
}

export interface PredictionMatchScorelineCount {
  goalsHome: number;
  goalsAway: number;
  n: number;
}

function getSqlite(db: Db): Database.Database {
  const client = (db as { $client?: Database.Database }).$client;
  if (!client) {
    throw new Error('SQLite client required for prediction aggregate rebuild');
  }
  return client;
}

/** Exclude matches with entered actual results from live prediction aggregates. */
const UNLOCKED_GROUP_MATCH_SQL = `sm.match_number NOT IN (SELECT match_number FROM actual_match_results)`;

function outcomeDeltas(
  goalsHome: number,
  goalsAway: number,
): Pick<PredictionMatchOutcomeCounts, 'homeWin' | 'draw' | 'awayWin'> & { total: number } {
  if (goalsHome > goalsAway) {
    return { homeWin: 1, draw: 0, awayWin: 0, total: 1 };
  }
  if (goalsHome < goalsAway) {
    return { homeWin: 0, draw: 0, awayWin: 1, total: 1 };
  }
  return { homeWin: 0, draw: 1, awayWin: 0, total: 1 };
}

function adjustPredictionMatchOutcome(
  db: Db,
  predictionId: number,
  matchNumber: number,
  goalsHome: number,
  goalsAway: number,
  direction: 1 | -1,
): void {
  const delta = outcomeDeltas(goalsHome, goalsAway);
  const existing = db
    .select()
    .from(schema.predictionMatchOutcomes)
    .where(
      and(
        eq(schema.predictionMatchOutcomes.predictionId, predictionId),
        eq(schema.predictionMatchOutcomes.matchNumber, matchNumber),
      ),
    )
    .get();

  const homeWin = (existing?.homeWin ?? 0) + delta.homeWin * direction;
  const draw = (existing?.draw ?? 0) + delta.draw * direction;
  const awayWin = (existing?.awayWin ?? 0) + delta.awayWin * direction;
  const total = (existing?.total ?? 0) + delta.total * direction;

  if (total <= 0) {
    if (existing) {
      db.delete(schema.predictionMatchOutcomes)
        .where(
          and(
            eq(schema.predictionMatchOutcomes.predictionId, predictionId),
            eq(schema.predictionMatchOutcomes.matchNumber, matchNumber),
          ),
        )
        .run();
    }
    return;
  }

  if (existing) {
    db.update(schema.predictionMatchOutcomes)
      .set({ homeWin, draw, awayWin, total })
      .where(
        and(
          eq(schema.predictionMatchOutcomes.predictionId, predictionId),
          eq(schema.predictionMatchOutcomes.matchNumber, matchNumber),
        ),
      )
      .run();
  } else {
    db.insert(schema.predictionMatchOutcomes)
      .values({ predictionId, matchNumber, homeWin, draw, awayWin, total })
      .run();
  }
}

function adjustPredictionMatchScoreline(
  db: Db,
  predictionId: number,
  matchNumber: number,
  goalsHome: number,
  goalsAway: number,
  direction: 1 | -1,
): void {
  const existing = db
    .select()
    .from(schema.predictionMatchScorelines)
    .where(
      and(
        eq(schema.predictionMatchScorelines.predictionId, predictionId),
        eq(schema.predictionMatchScorelines.matchNumber, matchNumber),
        eq(schema.predictionMatchScorelines.goalsHome, goalsHome),
        eq(schema.predictionMatchScorelines.goalsAway, goalsAway),
      ),
    )
    .get();

  const count = (existing?.count ?? 0) + direction;

  if (count <= 0) {
    if (existing) {
      db.delete(schema.predictionMatchScorelines)
        .where(
          and(
            eq(schema.predictionMatchScorelines.predictionId, predictionId),
            eq(schema.predictionMatchScorelines.matchNumber, matchNumber),
            eq(schema.predictionMatchScorelines.goalsHome, goalsHome),
            eq(schema.predictionMatchScorelines.goalsAway, goalsAway),
          ),
        )
        .run();
    }
    return;
  }

  if (existing) {
    db.update(schema.predictionMatchScorelines)
      .set({ count })
      .where(
        and(
          eq(schema.predictionMatchScorelines.predictionId, predictionId),
          eq(schema.predictionMatchScorelines.matchNumber, matchNumber),
          eq(schema.predictionMatchScorelines.goalsHome, goalsHome),
          eq(schema.predictionMatchScorelines.goalsAway, goalsAway),
        ),
      )
      .run();
  } else {
    db.insert(schema.predictionMatchScorelines)
      .values({ predictionId, matchNumber, goalsHome, goalsAway, count })
      .run();
  }
}

function applyGroupMatchResult(
  db: Db,
  predictionId: number,
  matchNumber: number,
  goalsHome: number,
  goalsAway: number,
  direction: 1 | -1,
): void {
  adjustPredictionMatchOutcome(db, predictionId, matchNumber, goalsHome, goalsAway, direction);
  adjustPredictionMatchScoreline(db, predictionId, matchNumber, goalsHome, goalsAway, direction);
}

function adjustPredictionTeamStats(
  db: Db,
  predictionId: number,
  teamId: number,
  goalsDelta: number,
  simulationsDelta: number,
  championDelta: number,
): void {
  if (goalsDelta === 0 && simulationsDelta === 0 && championDelta === 0) return;

  const existing = db
    .select()
    .from(schema.predictionTeamStats)
    .where(
      and(
        eq(schema.predictionTeamStats.predictionId, predictionId),
        eq(schema.predictionTeamStats.teamId, teamId),
      ),
    )
    .get();

  const totalGoals = (existing?.totalGoals ?? 0) + goalsDelta;
  const simulationsWithMatches = (existing?.simulationsWithMatches ?? 0) + simulationsDelta;
  const championWins = (existing?.championWins ?? 0) + championDelta;

  if (totalGoals === 0 && simulationsWithMatches === 0 && championWins === 0) {
    if (existing) {
      db.delete(schema.predictionTeamStats)
        .where(
          and(
            eq(schema.predictionTeamStats.predictionId, predictionId),
            eq(schema.predictionTeamStats.teamId, teamId),
          ),
        )
        .run();
    }
    return;
  }

  if (existing) {
    db.update(schema.predictionTeamStats)
      .set({ totalGoals, simulationsWithMatches, championWins })
      .where(
        and(
          eq(schema.predictionTeamStats.predictionId, predictionId),
          eq(schema.predictionTeamStats.teamId, teamId),
        ),
      )
      .run();
  } else {
    db.insert(schema.predictionTeamStats)
      .values({ predictionId, teamId, totalGoals, simulationsWithMatches, championWins })
      .run();
  }
}

function readPredictionGroupMatchResults(
  db: Db,
  predictionId: number,
  simulationId: number,
): Map<number, { goalsHome: number; goalsAway: number }> {
  const rows = db
    .select()
    .from(schema.predictionGroupMatchResults)
    .where(
      and(
        eq(schema.predictionGroupMatchResults.predictionId, predictionId),
        eq(schema.predictionGroupMatchResults.simulationId, simulationId),
      ),
    )
    .all();

  return new Map(
    rows.map((row) => [row.matchNumber, { goalsHome: row.goalsHome, goalsAway: row.goalsAway }]),
  );
}

function readCurrentGroupMatchResults(
  db: Db,
  simulationId: number,
): Map<number, { goalsHome: number; goalsAway: number }> {
  const sqlite = getSqlite(db);
  const rows = sqlite
    .prepare(
      `SELECT sm.match_number AS matchNumber, sm.goals_home AS goalsHome, sm.goals_away AS goalsAway
       FROM simulation_matches sm
       INNER JOIN fixtures f ON f.match_number = sm.match_number
       WHERE sm.simulation_id = ?
         AND f."group" IS NOT NULL
         AND sm.status = 'played'
         AND sm.goals_home IS NOT NULL
         AND sm.goals_away IS NOT NULL
         AND ${UNLOCKED_GROUP_MATCH_SQL}`,
    )
    .all(simulationId) as Array<{ matchNumber: number; goalsHome: number; goalsAway: number }>;

  return new Map(rows.map((row) => [row.matchNumber, { goalsHome: row.goalsHome, goalsAway: row.goalsAway }]));
}

export function refreshSimulationInPredictionAggregates(
  db: Db,
  predictionId: number,
  simulationId: number,
): void {
  const oldResults = readPredictionGroupMatchResults(db, predictionId, simulationId);
  const newResults = readCurrentGroupMatchResults(db, simulationId);
  const affectedMatchNumbers = new Set([...oldResults.keys(), ...newResults.keys()]);

  for (const matchNumber of affectedMatchNumbers) {
    const oldResult = oldResults.get(matchNumber);
    const newResult = newResults.get(matchNumber);

    if (
      oldResult &&
      newResult &&
      oldResult.goalsHome === newResult.goalsHome &&
      oldResult.goalsAway === newResult.goalsAway
    ) {
      continue;
    }

    if (oldResult) {
      applyGroupMatchResult(
        db,
        predictionId,
        matchNumber,
        oldResult.goalsHome,
        oldResult.goalsAway,
        -1,
      );
    }
    if (newResult) {
      applyGroupMatchResult(
        db,
        predictionId,
        matchNumber,
        newResult.goalsHome,
        newResult.goalsAway,
        1,
      );
    }
  }

  db.delete(schema.predictionGroupMatchResults)
    .where(
      and(
        eq(schema.predictionGroupMatchResults.predictionId, predictionId),
        eq(schema.predictionGroupMatchResults.simulationId, simulationId),
      ),
    )
    .run();

  for (const [matchNumber, result] of newResults) {
    db.insert(schema.predictionGroupMatchResults)
      .values({
        predictionId,
        simulationId,
        matchNumber,
        goalsHome: result.goalsHome,
        goalsAway: result.goalsAway,
      })
      .run();
  }

  refreshSimulationTeamGoalsForPrediction(db, predictionId, simulationId);
}

function refreshSimulationTeamGoalsForPrediction(
  db: Db,
  predictionId: number,
  simulationId: number,
): void {
  const oldRows = db
    .select()
    .from(schema.predictionSimulationTeamGoals)
    .where(
      and(
        eq(schema.predictionSimulationTeamGoals.predictionId, predictionId),
        eq(schema.predictionSimulationTeamGoals.simulationId, simulationId),
      ),
    )
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
    adjustPredictionTeamStats(
      db,
      predictionId,
      teamId,
      newGoals - oldGoals,
      (hasMatches ? 1 : 0) - (hadMatches ? 1 : 0),
      0,
    );
  }

  db.delete(schema.predictionSimulationTeamGoals)
    .where(
      and(
        eq(schema.predictionSimulationTeamGoals.predictionId, predictionId),
        eq(schema.predictionSimulationTeamGoals.simulationId, simulationId),
      ),
    )
    .run();

  for (const [teamId, goals] of newGoalsByTeam) {
    if (goals <= 0) continue;
    db.insert(schema.predictionSimulationTeamGoals)
      .values({ predictionId, simulationId, teamId, goals })
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
    if (oldChampion != null) adjustPredictionTeamStats(db, predictionId, oldChampion, 0, 0, -1);
    if (newChampion != null) adjustPredictionTeamStats(db, predictionId, newChampion, 0, 0, 1);
    db.update(schema.simulations)
      .set({ championTeamId: newChampion })
      .where(eq(schema.simulations.id, simulationId))
      .run();
  }
}

export function removeSimulationFromPredictionAggregates(
  db: Db,
  predictionId: number,
  simulationId: number,
): void {
  const oldResults = readPredictionGroupMatchResults(db, predictionId, simulationId);
  for (const [matchNumber, result] of oldResults) {
    applyGroupMatchResult(
      db,
      predictionId,
      matchNumber,
      result.goalsHome,
      result.goalsAway,
      -1,
    );
  }
  db.delete(schema.predictionGroupMatchResults)
    .where(
      and(
        eq(schema.predictionGroupMatchResults.predictionId, predictionId),
        eq(schema.predictionGroupMatchResults.simulationId, simulationId),
      ),
    )
    .run();

  const goalRows = db
    .select()
    .from(schema.predictionSimulationTeamGoals)
    .where(
      and(
        eq(schema.predictionSimulationTeamGoals.predictionId, predictionId),
        eq(schema.predictionSimulationTeamGoals.simulationId, simulationId),
      ),
    )
    .all();
  for (const row of goalRows) {
    adjustPredictionTeamStats(db, predictionId, row.teamId, -row.goals, -1, 0);
  }

  const simulation = db
    .select({ championTeamId: schema.simulations.championTeamId })
    .from(schema.simulations)
    .where(eq(schema.simulations.id, simulationId))
    .get();
  if (simulation?.championTeamId != null) {
    adjustPredictionTeamStats(db, predictionId, simulation.championTeamId, 0, 0, -1);
  }

  db.delete(schema.predictionSimulationTeamGoals)
    .where(
      and(
        eq(schema.predictionSimulationTeamGoals.predictionId, predictionId),
        eq(schema.predictionSimulationTeamGoals.simulationId, simulationId),
      ),
    )
    .run();
}

export function deletePredictionAggregates(db: Db, predictionId: number): void {
  db.delete(schema.predictionGroupMatchResults)
    .where(
      and(
        eq(schema.predictionGroupMatchResults.predictionId, predictionId),
        sql`${schema.predictionGroupMatchResults.matchNumber} NOT IN (SELECT match_number FROM actual_match_results)`,
      ),
    )
    .run();
  db.delete(schema.predictionSimulationTeamGoals)
    .where(eq(schema.predictionSimulationTeamGoals.predictionId, predictionId))
    .run();
  db.delete(schema.predictionMatchOutcomes)
    .where(eq(schema.predictionMatchOutcomes.predictionId, predictionId))
    .run();
  db.delete(schema.predictionMatchScorelines)
    .where(eq(schema.predictionMatchScorelines.predictionId, predictionId))
    .run();
  db.delete(schema.predictionTeamStats)
    .where(eq(schema.predictionTeamStats.predictionId, predictionId))
    .run();
}

export function removeLiveMatchFromAggregates(
  db: Db,
  predictionId: number,
  matchNumber: number,
): void {
  db.delete(schema.predictionMatchOutcomes)
    .where(
      and(
        eq(schema.predictionMatchOutcomes.predictionId, predictionId),
        eq(schema.predictionMatchOutcomes.matchNumber, matchNumber),
      ),
    )
    .run();
  db.delete(schema.predictionMatchScorelines)
    .where(
      and(
        eq(schema.predictionMatchScorelines.predictionId, predictionId),
        eq(schema.predictionMatchScorelines.matchNumber, matchNumber),
      ),
    )
    .run();
}

export function rebuildPredictionAggregates(
  db: Db,
  predictionId: number,
  spec: SelectionSpec,
): void {
  const sqlite = getSqlite(db);
  const simFilter = buildSimulationIdSqlFilter(spec);

  deletePredictionAggregates(db, predictionId);

  sqlite.exec(`
    INSERT INTO prediction_match_outcomes (prediction_id, match_number, home_win, draw, away_win, total)
    SELECT
      ${predictionId},
      sm.match_number,
      sum(CASE WHEN sm.goals_home > sm.goals_away THEN 1 ELSE 0 END),
      sum(CASE WHEN sm.goals_home = sm.goals_away THEN 1 ELSE 0 END),
      sum(CASE WHEN sm.goals_home < sm.goals_away THEN 1 ELSE 0 END),
      count(*)
    FROM simulation_matches sm
    INNER JOIN fixtures f ON f.match_number = sm.match_number
    WHERE f."group" IS NOT NULL
      AND sm.status = 'played'
      AND sm.goals_home IS NOT NULL
      AND sm.goals_away IS NOT NULL
      AND ${UNLOCKED_GROUP_MATCH_SQL}
      AND ${simFilter}
      AND ${KNOCKOUT_SNAPSHOT_SIMULATION_SQL}
    GROUP BY sm.match_number;

    INSERT INTO prediction_match_scorelines (prediction_id, match_number, goals_home, goals_away, count)
    SELECT ${predictionId}, sm.match_number, sm.goals_home, sm.goals_away, count(*)
    FROM simulation_matches sm
    INNER JOIN fixtures f ON f.match_number = sm.match_number
    WHERE f."group" IS NOT NULL
      AND sm.status = 'played'
      AND sm.goals_home IS NOT NULL
      AND sm.goals_away IS NOT NULL
      AND ${UNLOCKED_GROUP_MATCH_SQL}
      AND ${simFilter}
      AND ${KNOCKOUT_SNAPSHOT_SIMULATION_SQL}
    GROUP BY sm.match_number, sm.goals_home, sm.goals_away;

    INSERT INTO prediction_group_match_results (prediction_id, simulation_id, match_number, goals_home, goals_away)
    SELECT ${predictionId}, sm.simulation_id, sm.match_number, sm.goals_home, sm.goals_away
    FROM simulation_matches sm
    INNER JOIN fixtures f ON f.match_number = sm.match_number
    WHERE f."group" IS NOT NULL
      AND sm.status = 'played'
      AND sm.goals_home IS NOT NULL
      AND sm.goals_away IS NOT NULL
      AND ${UNLOCKED_GROUP_MATCH_SQL}
      AND ${simFilter}
      AND ${KNOCKOUT_SNAPSHOT_SIMULATION_SQL};

    INSERT INTO prediction_simulation_team_goals (prediction_id, simulation_id, team_id, goals)
    SELECT ${predictionId}, simulation_id, team_id, SUM(goals)
    FROM (
      SELECT sm.simulation_id, sm.team_home_id AS team_id, sm.goals_home AS goals
      FROM simulation_matches sm
      WHERE sm.status = 'played'
        AND sm.team_home_id IS NOT NULL
        AND sm.goals_home IS NOT NULL
        AND ${simFilter}
        AND ${KNOCKOUT_SNAPSHOT_SIMULATION_SQL}
      UNION ALL
      SELECT sm.simulation_id, sm.team_away_id AS team_id, sm.goals_away AS goals
      FROM simulation_matches sm
      WHERE sm.status = 'played'
        AND sm.team_away_id IS NOT NULL
        AND sm.goals_away IS NOT NULL
        AND ${simFilter}
        AND ${KNOCKOUT_SNAPSHOT_SIMULATION_SQL}
    )
    GROUP BY simulation_id, team_id;

    INSERT INTO prediction_team_stats (prediction_id, team_id, total_goals, simulations_with_matches, champion_wins)
    SELECT
      ${predictionId},
      all_teams.team_id,
      COALESCE(goal_stats.total_goals, 0),
      COALESCE(goal_stats.simulations_with_matches, 0),
      COALESCE(champion_stats.champion_wins, 0)
    FROM (
      SELECT team_id FROM prediction_simulation_team_goals WHERE prediction_id = ${predictionId}
      UNION
      SELECT sm.winner_team_id
      FROM simulation_matches sm
      WHERE sm.match_number = ${FINAL_MATCH_NUMBER}
        AND sm.status = 'played'
        AND sm.winner_team_id IS NOT NULL
        AND ${simFilter}
        AND ${KNOCKOUT_SNAPSHOT_SIMULATION_SQL}
    ) AS all_teams
    LEFT JOIN (
      SELECT team_id, SUM(goals) AS total_goals, COUNT(*) AS simulations_with_matches
      FROM prediction_simulation_team_goals
      WHERE prediction_id = ${predictionId}
      GROUP BY team_id
    ) goal_stats ON goal_stats.team_id = all_teams.team_id
    LEFT JOIN (
      SELECT sm.winner_team_id AS team_id, COUNT(*) AS champion_wins
      FROM simulation_matches sm
      WHERE sm.match_number = ${FINAL_MATCH_NUMBER}
        AND sm.status = 'played'
        AND sm.winner_team_id IS NOT NULL
        AND ${simFilter}
        AND ${KNOCKOUT_SNAPSHOT_SIMULATION_SQL}
      GROUP BY sm.winner_team_id
    ) champion_stats ON champion_stats.team_id = all_teams.team_id;
  `);
}

export function readPredictionMatchDistributions(
  db: Db,
  predictionId: number,
): {
  outcomesByMatch: Map<number, PredictionMatchOutcomeCounts>;
  scorelinesByMatch: Map<number, PredictionMatchScorelineCount[]>;
} {
  const outcomeRows = db
    .select()
    .from(schema.predictionMatchOutcomes)
    .where(eq(schema.predictionMatchOutcomes.predictionId, predictionId))
    .all();
  const scorelineRows = db
    .select()
    .from(schema.predictionMatchScorelines)
    .where(eq(schema.predictionMatchScorelines.predictionId, predictionId))
    .all();

  const outcomesByMatch = new Map(
    outcomeRows.map((row) => [
      row.matchNumber,
      {
        homeWin: row.homeWin,
        draw: row.draw,
        awayWin: row.awayWin,
        total: row.total,
      },
    ]),
  );

  const scorelinesByMatch = new Map<number, PredictionMatchScorelineCount[]>();
  for (const row of scorelineRows) {
    const list = scorelinesByMatch.get(row.matchNumber) ?? [];
    list.push({ goalsHome: row.goalsHome, goalsAway: row.goalsAway, n: row.count });
    scorelinesByMatch.set(row.matchNumber, list);
  }

  return { outcomesByMatch, scorelinesByMatch };
}

export function readPredictionTeamStats(
  db: Db,
  predictionId: number,
  spec: SelectionSpec,
  teams: Team[],
): MasterTeamStats {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const sqlite = getSqlite(db);
  const simFilter = buildSimulationIdSqlFilter(spec);
  const simulationCountRow = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM simulations s WHERE ${simFilter.replaceAll('sm.simulation_id', 's.id')}`)
    .get() as { n: number };

  const rows = db
    .select()
    .from(schema.predictionTeamStats)
    .where(eq(schema.predictionTeamStats.predictionId, predictionId))
    .all();

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

  return { simulationCount: Number(simulationCountRow?.n ?? 0), teams: teamStats };
}

export function rebuildAllPredictionAggregates(
  db: Db,
  predictions: Array<{ id: number; selectionSpec: SelectionSpec }>,
): void {
  for (const prediction of predictions) {
    rebuildPredictionAggregates(db, prediction.id, prediction.selectionSpec);
  }
}
