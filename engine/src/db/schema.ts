import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';
import type { Phase } from '../engine/phase.js';

export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  countryCode: text('country_code'),
  flag: text('flag').notNull(),
  rank: integer('rank').notNull(),
  rating: integer('rating').notNull(),
  elo: integer('elo').notNull(),
  total: integer('total').notNull(),
  goalsFor: integer('goals_for').notNull(),
  goalsAgainst: integer('goals_against').notNull(),
  eloOffensiveRating: real('elo_offensive_rating').notNull(),
  eloDefensiveRating: real('elo_defensive_rating').notNull(),
  goalOffensiveRating: real('goal_offensive_rating').notNull(),
  goalDefensiveRating: real('goal_defensive_rating').notNull(),
  blendOffensiveRating: real('blend_offensive_rating').notNull(),
  blendDefensiveRating: real('blend_defensive_rating').notNull(),
});

export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey(),
  ratingEloWeight: real('rating_elo_weight').notNull(),
  tournamentEloDeltaWeight: real('tournament_elo_delta_weight').notNull().default(2),
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

export const predictions = sqliteTable('predictions', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  selectionSpec: text('selection_spec').notNull(),
  consensusMode: text('consensus_mode')
    .notNull()
    .$type<'scoreline' | 'outcome' | 'expected' | 'rounded' | 'draw'>()
    .default('expected'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const predictionGroupMatchResults = sqliteTable(
  'prediction_group_match_results',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    simulationId: integer('simulation_id')
      .notNull()
      .references(() => simulations.id),
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
    goalsHome: integer('goals_home').notNull(),
    goalsAway: integer('goals_away').notNull(),
  },
  (t) => [primaryKey({ columns: [t.predictionId, t.simulationId, t.matchNumber] })],
);

export const predictionSimulationTeamGoals = sqliteTable(
  'prediction_simulation_team_goals',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    simulationId: integer('simulation_id')
      .notNull()
      .references(() => simulations.id),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    goals: integer('goals').notNull(),
  },
  (t) => [primaryKey({ columns: [t.predictionId, t.simulationId, t.teamId] })],
);

export const predictionMatchOutcomes = sqliteTable(
  'prediction_match_outcomes',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
    homeWin: integer('home_win').notNull(),
    draw: integer('draw').notNull(),
    awayWin: integer('away_win').notNull(),
    total: integer('total').notNull(),
  },
  (t) => [primaryKey({ columns: [t.predictionId, t.matchNumber] })],
);

export const predictionMatchScorelines = sqliteTable(
  'prediction_match_scorelines',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
    goalsHome: integer('goals_home').notNull(),
    goalsAway: integer('goals_away').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.predictionId, t.matchNumber, t.goalsHome, t.goalsAway],
    }),
  ],
);

export const predictionTeamStats = sqliteTable(
  'prediction_team_stats',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    totalGoals: integer('total_goals').notNull(),
    simulationsWithMatches: integer('simulations_with_matches').notNull(),
    championWins: integer('champion_wins').notNull(),
  },
  (t) => [primaryKey({ columns: [t.predictionId, t.teamId] })],
);

export const predictionDrawResults = sqliteTable(
  'prediction_draw_results',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
    goalsHome: integer('goals_home').notNull(),
    goalsAway: integer('goals_away').notNull(),
    drawnAt: text('drawn_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.predictionId, t.matchNumber] })],
);

export const predictionFrozenMatches = sqliteTable(
  'prediction_frozen_matches',
  {
    predictionId: integer('prediction_id')
      .notNull()
      .references(() => predictions.id),
    matchNumber: integer('match_number')
      .notNull()
      .references(() => fixtures.matchNumber),
    homeWin: integer('home_win').notNull(),
    draw: integer('draw').notNull(),
    awayWin: integer('away_win').notNull(),
    total: integer('total').notNull(),
    scorelinesJson: text('scorelines_json').notNull(),
    consensusMode: text('consensus_mode')
      .notNull()
      .$type<'scoreline' | 'outcome' | 'expected' | 'rounded' | 'draw'>()
      .default('expected'),
    frozenAt: text('frozen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.predictionId, t.matchNumber] })],
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

export const simulationTeamEloDelta = sqliteTable(
  'simulation_team_elo_delta',
  {
    simulationId: integer('simulation_id')
      .notNull()
      .references(() => simulations.id),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    eloDelta: real('elo_delta').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.simulationId, t.teamId] })],
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
