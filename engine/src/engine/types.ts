import type { Phase } from './phase.js';
import type { SelectionSpec } from '../lib/simulationSelection.js';

export type { Phase };
export type MatchStatus = 'scheduled' | 'played';
export type RatingEloWeight = number;
export type TournamentEloDeltaWeight = number;

export interface Team {
  id: number;
  name: string;
  countryCode: string | null;
  flag: string;
  rank: number;
  rating: number;
  elo: number;
  total: number;
  goalsFor: number;
  goalsAgainst: number;
  eloOffensiveRating: number;
  eloDefensiveRating: number;
  goalOffensiveRating: number;
  goalDefensiveRating: number;
  blendOffensiveRating: number;
  blendDefensiveRating: number;
  /** Effective ratings used by the simulator (blend columns). */
  offensiveRating?: number;
  defensiveRating?: number;
}

export interface GroupMembership {
  groupLetter: string;
  teamId: number;
}

export interface Fixture {
  matchNumber: number;
  round: string;
  date: string;
  time: string;
  venue: string;
  group: string | null;
  slotHome: string;
  slotAway: string;
  teamHomeId: number | null;
  teamAwayId: number | null;
}

export interface SimulationMatch {
  simulationId: number;
  matchNumber: number;
  teamHomeId: number | null;
  teamAwayId: number | null;
  goalsHome: number | null;
  goalsAway: number | null;
  penGoalsHome: number | null;
  penGoalsAway: number | null;
  winnerTeamId: number | null;
  status: MatchStatus;
}

export interface Simulation {
  id: number;
  name: string;
  phase: Phase;
  annexCCombinationId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SimulationListEntry extends Simulation {
  playedCount: number;
}

export interface SimulationListPage {
  items: SimulationListEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StandingRow {
  teamId: number;
  team: Team;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  position: number;
}

export interface GroupStandings {
  groupLetter: string;
  rows: StandingRow[];
}

export interface ActualMatchResult {
  matchNumber: number;
  goalsHome: number;
  goalsAway: number;
  winnerTeamId: number | null;
  recordedAt: string;
  /** Sample-mode consensus prediction locked when the actual result was first entered. */
  predictedGoalsHome?: number | null;
  predictedGoalsAway?: number | null;
}

export interface ResolvedMatch {
  fixture: Fixture;
  result: SimulationMatch;
  homeTeam: Team | null;
  awayTeam: Team | null;
  homeLabel: string;
  awayLabel: string;
  isLocked: boolean;
}

export interface TournamentState {
  simulation: Simulation;
  teams: Map<number, Team>;
  fixtures: Fixture[];
  matches: SimulationMatch[];
  groupMemberships: GroupMembership[];
  groupStandings: GroupStandings[];
  qualifyingThirdGroups: string[];
  thirdPlaceOrder: ThirdPlaceOrderRow[];
  annexCCombinationId: number | null;
  resolvedMatches: ResolvedMatch[];
  actualResults: ActualMatchResult[];
  /** Per-team tournament Elo adjustment for this simulation branch. */
  eloDeltas: Map<number, number>;
}

export interface ScorelineCount {
  goalsHome: number;
  goalsAway: number;
  n: number;
}

export interface OutcomeDistribution {
  homeWin: number;
  draw: number;
  awayWin: number;
  total: number;
  scorelines: ScorelineCount[];
  /** Frozen consensus strategy for locked matches. */
  consensusMode?: MasterGroupState['consensusMode'];
}

export interface MasterGroupState {
  consensusMode: 'scoreline' | 'outcome' | 'floor' | 'rounded' | 'sample';
  resolvedMatches: ResolvedMatch[];
  groupStandings: GroupStandings[];
  qualifyingThirdGroups: string[];
  distributions: Record<number, OutcomeDistribution>;
  sample?: { sampledAt: string; matchCount: number } | null;
  sampleResults?: Record<number, { goalsHome: number; goalsAway: number }>;
}

export interface ThirdPlaceOrderRow {
  groupLetter: string;
  position: number;
  teamId: number;
  team: Team;
  points: number;
  goalDifference: number;
  goalsFor: number;
  qualified: boolean;
}

export interface KnockoutRoundAvailability {
  name: string;
  label: string;
  matches: number[];
  canSimulate: boolean;
  isComplete: boolean;
  disabledReason?: string;
}

export interface MasterKnockoutState {
  consensusMode: 'scoreline' | 'outcome' | 'floor' | 'rounded' | 'sample';
  resolvedMatches: ResolvedMatch[];
  thirdPlaceOrder: ThirdPlaceOrderRow[];
  qualifyingThirdGroups: string[];
  annexCCombinationId: number | null;
  rounds: KnockoutRoundAvailability[];
  distributions: Record<number, OutcomeDistribution>;
  hasKnockoutResults: boolean;
  groupStageComplete: boolean;
  activeKnockoutSimulationId: number | null;
  knockoutRuns: Array<{ id: number; name: string }>;
}

export interface MasterTeamStatsRow {
  teamId: number;
  teamName: string;
  countryCode: string | null;
  flag: string;
  totalGoals: number;
  simulationsWithMatches: number;
  avgGoalsPerSimulation: number;
  championWins: number;
}

export interface MasterTeamStats {
  simulationCount: number;
  teams: MasterTeamStatsRow[];
}

export interface Prediction {
  id: number;
  name: string;
  selectionSpec: SelectionSpec;
  consensusMode: 'scoreline' | 'outcome' | 'floor' | 'rounded' | 'sample';
  activeKnockoutSimulationId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PredictionListEntry extends Prediction {
  simulationCount: number;
  selectionLabel: string;
}

export interface PredictionListPage {
  items: PredictionListEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ValidateSelectionResult {
  count: number;
  minId: number | null;
  maxId: number | null;
}
