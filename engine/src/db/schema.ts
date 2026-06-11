import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';
import type { Phase } from '../engine/phase.js';

export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  countryCode: text('country_code'),
  flag: text('flag').notNull(),
  rank: integer('rank').notNull(),
  rating: integer('rating').notNull(),
  total: integer('total').notNull(),
  goalsFor: integer('goals_for').notNull(),
  goalsAgainst: integer('goals_against').notNull(),
  offensiveRating: real('offensive_rating').notNull(),
  defensiveRating: real('defensive_rating').notNull(),
});

export const groupMemberships = sqliteTable(
  'group_memberships',
  {
    groupLetter: text('group_letter').notNull(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
  },
  (t) => [primaryKey({ columns: [t.groupLetter, t.teamId] })],
);

export const fixtures = sqliteTable('fixtures', {
  matchNumber: integer('match_number').primaryKey(),
  round: text('round').notNull(),
  date: text('date').notNull(),
  time: text('time').notNull(),
  venue: text('venue').notNull(),
  group: text('group'),
  slotHome: text('slot_home').notNull(),
  slotAway: text('slot_away').notNull(),
  teamHomeId: integer('team_home_id').references(() => teams.id),
  teamAwayId: integer('team_away_id').references(() => teams.id),
});

export const simulations = sqliteTable('simulations', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  phase: text('phase').notNull().$type<Phase>(),
  annexCCombinationId: integer('annex_c_combination_id'),
  championTeamId: integer('champion_team_id').references(() => teams.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const simulationTeamGoals = sqliteTable(
  'simulation_team_goals',
  {
    simulationId: integer('simulation_id')
      .notNull()
      .references(() => simulations.id),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    goals: integer('goals').notNull(),
  },
  (t) => [primaryKey({ columns: [t.simulationId, t.teamId] })],
);

export const masterTeamStats = sqliteTable('master_team_stats', {
  teamId: integer('team_id')
    .primaryKey()
    .references(() => teams.id),
  totalGoals: integer('total_goals').notNull(),
  simulationsWithMatches: integer('simulations_with_matches').notNull(),
  championWins: integer('champion_wins').notNull(),
});

export const simulationGroupMatchResults = sqliteTable(
  'simulation_group_match_results',
  {
    simulationId: integer('simulation_id')
      .notNull()
      .references(() => simulations.id),
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
    goalsHome: integer('goals_home').notNull(),
    goalsAway: integer('goals_away').notNull(),
  },
  (t) => [primaryKey({ columns: [t.simulationId, t.matchNumber] })],
);

export const masterMatchOutcomes = sqliteTable('master_match_outcomes', {
  matchNumber: integer('match_number')
    .primaryKey()
    .references(() => fixtures.matchNumber),
  homeWin: integer('home_win').notNull(),
  draw: integer('draw').notNull(),
  awayWin: integer('away_win').notNull(),
  total: integer('total').notNull(),
});

export const masterMatchScorelines = sqliteTable(
  'master_match_scorelines',
  {
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
    goalsHome: integer('goals_home').notNull(),
    goalsAway: integer('goals_away').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchNumber, t.goalsHome, t.goalsAway] })],
);

export const simulationMatches = sqliteTable(
  'simulation_matches',
  {
    simulationId: integer('simulation_id')
      .notNull()
      .references(() => simulations.id),
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
    teamHomeId: integer('team_home_id').references(() => teams.id),
    teamAwayId: integer('team_away_id').references(() => teams.id),
    goalsHome: integer('goals_home'),
    goalsAway: integer('goals_away'),
    winnerTeamId: integer('winner_team_id').references(() => teams.id),
    status: text('status').notNull().$type<'scheduled' | 'played'>(),
  },
  (t) => [primaryKey({ columns: [t.simulationId, t.matchNumber] })],
);

export const actualMatchResults = sqliteTable('actual_match_results', {
  matchNumber: integer('match_number')
    .primaryKey()
    .references(() => fixtures.matchNumber),
  goalsHome: integer('goals_home').notNull(),
  goalsAway: integer('goals_away').notNull(),
  winnerTeamId: integer('winner_team_id').references(() => teams.id),
  recordedAt: text('recorded_at').notNull(),
});
