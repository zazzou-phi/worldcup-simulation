export type { Phase } from '@shared/engine/phase.js';
export type MatchStatus = 'scheduled' | 'played';

export interface Team {
  id: number;
  name: string;
  countryCode: string | null;
  flag: string;
  rank: number;
  rating: number;
  total: number;
  goalsFor: number;
  goalsAgainst: number;
  offensiveRating: number;
  defensiveRating: number;
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
  matchNumber: number;
  teamHomeId: number | null;
  teamAwayId: number | null;
  goalsHome: number | null;
  goalsAway: number | null;
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
  teams: Record<string, Team>;
  fixtures: Fixture[];
  matches: SimulationMatch[];
  groupMemberships: Array<{ groupLetter: string; teamId: number }>;
  groupStandings: GroupStandings[];
  qualifyingThirdGroups: string[];
  annexCCombinationId: number | null;
  resolvedMatches: ResolvedMatch[];
  actualResults: ActualMatchResult[];
}

export interface ActualResultsState {
  actualResults: ActualMatchResult[];
  phase: Phase;
  groupStandings: GroupStandings[];
  qualifyingThirdGroups: string[];
  resolvedMatches: ResolvedMatch[];
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
}

export interface MasterGroupState {
  consensusMode: 'scoreline' | 'outcome' | 'expected';
  resolvedMatches: ResolvedMatch[];
  groupStandings: GroupStandings[];
  qualifyingThirdGroups: string[];
  distributions: Record<string, OutcomeDistribution>;
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

export interface PublicMeta {
  exportedAt: string;
  revealPolicy: 'kickoff';
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

export interface ApiErrorBody {
  error: string;
  code: string;
}

export interface SetScoreResult {
  match: SimulationMatch;
  simulation: Simulation;
}

export interface MatchResultRow {
  matchNumber: number;
  goalsHome: number;
  goalsAway: number;
  winnerTeamId: number | null;
}

export interface SimulateGroupResult {
  simulationId: number;
  matchesPlayed: number;
  matchesSkipped: number;
  results: MatchResultRow[];
  simulation: Simulation;
}

export interface SimulateKnockoutsResult {
  simulationId: number;
  roundsPlayed: number;
  matchesPlayed: number;
  rounds: Array<{
    simulationId: number;
    round: string;
    matchesPlayed: number;
    matchesSkipped: number;
    results: MatchResultRow[];
  }>;
  simulation: Simulation;
}

export interface SimulateMatchResult extends MatchResultRow {
  simulation: Simulation;
}

export interface MonteCarloTeamResult {
  teamId: number;
  teamName: string;
  countryCode: string | null;
  flag: string;
  wins: number;
  winPct: number;
}

export interface MonteCarloResult {
  count: number;
  elapsedMs: number;
  champions: MonteCarloTeamResult[];
  batchName: string;
  firstSimulationId: number;
  lastSimulationId: number;
}
