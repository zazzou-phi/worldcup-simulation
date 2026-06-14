import type { Repository } from '../db/repository.js';
import { teamForSimulation } from '../engine/teamRatings.js';
import type { SimulationRatings } from '../engine/tournamentElo.js';
import {
  DEFAULT_UPSET_VARIANCE,
  simulateMatchOutcome,
  winnerFromGoals,
  type RandomSource,
  type GroupPhaseResult,
  type KnockoutRoundResult,
  type KnockoutsResult,
  type MatchResultRow,
  type SimulatedMatchOutcome,
  defaultRandomSource,
} from '../engine/matchSimulator.js';
import { compareFixturesChronologically } from '../engine/fixtureOrder.js';
import {
  type GroupGamesTarget,
  isGroupFixtureWithinGamesTarget,
} from '../engine/groupSimulation.js';
import { SIMULATION_KNOCKOUT_ROUNDS } from '../engine/simulationRounds.js';
import { isGroupStageComplete } from '../engine/phase.js';

export class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationError';
  }
}

export class SimulationRunner {
  constructor(
    private repo: Repository,
    private rng: RandomSource = defaultRandomSource,
    private upsetVariance: number = DEFAULT_UPSET_VARIANCE,
  ) {}

  private simTeam(team1: number | string, simulationId?: number) {
    const team = this.repo.getTeamByIdOrName(team1);
    if (!team) throw new SimulationError(`Team not found: ${team1}`);
    if (simulationId != null) {
      return this.repo.getTeamForSimulation(simulationId, team.id);
    }
    return teamForSimulation(team);
  }

  private prepareSimulationRatings(simulationId: number): Map<number, SimulationRatings> {
    return this.repo.getSimulationRatingsMap(simulationId);
  }

  private simTeamWithRatings(
    teamId: number,
    ratings: Map<number, SimulationRatings>,
  ) {
    const team = this.repo.getTeamByIdOrName(teamId);
    if (!team) throw new SimulationError(`Team not found: ${teamId}`);
    return teamForSimulation(team, ratings.get(team.id));
  }

  simulateMatch(
    team1: number | string,
    team2: number | string,
    knockout: boolean,
    gpg?: number,
  ): SimulatedMatchOutcome {
    const home = this.simTeam(team1);
    const away = this.simTeam(team2);
    return simulateMatchOutcome(home, away, knockout, {
      gpg,
      rng: this.rng,
      upsetVariance: this.upsetVariance,
    });
  }

  simulateGroupPhase(simulationId?: number): GroupPhaseResult {
    return this.simulateGroupPhaseUpTo(simulationId, 3);
  }

  simulateGroupPhaseUpTo(
    simulationId?: number,
    gamesTarget: GroupGamesTarget = 3,
  ): GroupPhaseResult {
    let resolvedId: number;
    if (simulationId != null && this.repo.simulationExists(simulationId)) {
      resolvedId = simulationId;
    } else {
      resolvedId = this.repo.createSimulation('Simulation').id;
    }

    this.repo.applyActualResultsToSimulation(resolvedId, { sync: false });

    const fixtures = this.repo
      .getFixtures()
      .filter((f) => f.group != null && isGroupFixtureWithinGamesTarget(f, gamesTarget))
      .sort(compareFixturesChronologically);

    const results: GroupPhaseResult['results'] = [];
    let skipped = 0;

    for (const fixture of fixtures) {
      const { matchNumber } = fixture;
      if (this.repo.isMatchLocked(matchNumber)) {
        skipped++;
        continue;
      }
      const status = this.repo.getMatchStatus(resolvedId, matchNumber);
      if (status === 'played') {
        skipped++;
        continue;
      }

      const homeId = fixture.teamHomeId;
      const awayId = fixture.teamAwayId;
      if (homeId == null || awayId == null) {
        throw new SimulationError(`Group fixture ${matchNumber} is missing team ids`);
      }

      const ratings = this.prepareSimulationRatings(resolvedId);
      const home = this.simTeamWithRatings(homeId, ratings);
      const away = this.simTeamWithRatings(awayId, ratings);
      const match = simulateMatchOutcome(home, away, false, {
        rng: this.rng,
        upsetVariance: this.upsetVariance,
      });
      const winnerTeamId = winnerFromGoals(match.goals1, match.goals2, homeId, awayId);

      this.repo.persistMatchResult(
        resolvedId,
        matchNumber,
        match.goals1,
        match.goals2,
        winnerTeamId,
        { sync: false },
      );

      results.push({
        matchNumber,
        goalsHome: match.goals1,
        goalsAway: match.goals2,
        winnerTeamId,
      });
    }

    this.repo.syncResolvedParticipants(resolvedId);

    return {
      simulationId: resolvedId,
      matchesPlayed: results.length,
      matchesSkipped: skipped,
      results,
    };
  }

  simulateSingleMatch(simulationId: number, matchNumber: number): MatchResultRow {
    if (!this.repo.simulationExists(simulationId)) {
      throw new SimulationError(`Simulation not found: ${simulationId}`);
    }
    if (this.repo.isMatchLocked(matchNumber)) {
      throw new SimulationError(`Match ${matchNumber} is locked`);
    }

    const fixture = this.repo.getFixtures().find((f) => f.matchNumber === matchNumber);
    if (!fixture) {
      throw new SimulationError(`Unknown match: ${matchNumber}`);
    }

    const status = this.repo.getMatchStatus(simulationId, matchNumber);
    if (status === 'played') {
      throw new SimulationError(`Match ${matchNumber} is already played`);
    }

    this.repo.applyActualResultsToSimulation(simulationId, { sync: false });
    this.repo.syncResolvedParticipants(simulationId);

    const isKnockout = fixture.group == null;
    let homeId: number | null;
    let awayId: number | null;

    if (isKnockout) {
      const matchRow = this.repo
        .getSimulationMatches(simulationId)
        .find((m) => m.matchNumber === matchNumber);
      if (!matchRow) {
        throw new SimulationError(`Unknown knockout match: ${matchNumber}`);
      }
      homeId = matchRow.teamHomeId;
      awayId = matchRow.teamAwayId;
    } else {
      homeId = fixture.teamHomeId;
      awayId = fixture.teamAwayId;
    }

    if (homeId == null || awayId == null) {
      throw new SimulationError(`Match ${matchNumber} has unresolved participants`);
    }

    const ratings = this.prepareSimulationRatings(simulationId);
    const home = this.simTeamWithRatings(homeId, ratings);
    const away = this.simTeamWithRatings(awayId, ratings);
    const match = simulateMatchOutcome(home, away, isKnockout, {
      rng: this.rng,
      upsetVariance: this.upsetVariance,
    });
    const winnerTeamId = isKnockout
      ? (match.winnerId ?? null)
      : winnerFromGoals(match.goals1, match.goals2, homeId, awayId);

    this.repo.persistMatchResult(
      simulationId,
      matchNumber,
      match.goals1,
      match.goals2,
      winnerTeamId,
      { sync: true },
    );

    return {
      matchNumber,
      goalsHome: match.goals1,
      goalsAway: match.goals2,
      winnerTeamId,
    };
  }

  simulateKnockouts(simulationId?: number): KnockoutsResult {
    const lastRound = SIMULATION_KNOCKOUT_ROUNDS[SIMULATION_KNOCKOUT_ROUNDS.length - 1]!.name;
    return this.simulateKnockoutsUpTo(simulationId, lastRound);
  }

  simulateKnockoutsUpTo(simulationId?: number, throughRoundName?: string): KnockoutsResult {
    const resolvedId = this.resolveKnockoutSimulationId(simulationId);
    const throughName =
      throughRoundName ?? SIMULATION_KNOCKOUT_ROUNDS[SIMULATION_KNOCKOUT_ROUNDS.length - 1]!.name;
    const throughIndex = SIMULATION_KNOCKOUT_ROUNDS.findIndex((r) => r.name === throughName);
    if (throughIndex < 0) {
      throw new SimulationError(`Unknown knockout round: ${throughName}`);
    }

    const fixtures = this.repo.getFixtures();
    const matches = this.repo.getSimulationMatches(resolvedId);
    if (!isGroupStageComplete(matches, fixtures)) {
      this.simulateGroupPhaseUpTo(resolvedId, 3);
    }

    const roundResults: KnockoutRoundResult[] = [];
    let totalMatches = 0;

    for (let i = 0; i <= throughIndex; i++) {
      const round = SIMULATION_KNOCKOUT_ROUNDS[i]!;
      const roundResult = this.simulateKnockoutRound(resolvedId, round.name, [...round.matches]);
      roundResults.push(roundResult);
      totalMatches += roundResult.matchesPlayed;
    }

    return {
      simulationId: resolvedId,
      roundsPlayed: roundResults.length,
      matchesPlayed: totalMatches,
      rounds: roundResults,
    };
  }

  simulateKnockoutRoundByName(roundName: string): KnockoutRoundResult {
    const round = SIMULATION_KNOCKOUT_ROUNDS.find((r) => r.name === roundName);
    if (!round) {
      throw new SimulationError(`Unknown knockout round: ${roundName}`);
    }
    const simulationId = this.resolveKnockoutSimulationId(undefined);
    return this.simulateKnockoutRound(simulationId, roundName, [...round.matches]);
  }

  private resolveKnockoutSimulationId(simulationId?: number): number {
    if (simulationId != null && this.repo.simulationExists(simulationId)) {
      return simulationId;
    }
    const chosen = this.repo.chooseKnockoutSimulation();
    if (chosen == null) {
      throw new SimulationError('No simulation ready for the knockout stage');
    }
    return chosen;
  }

  private simulateKnockoutRound(
    simulationId: number,
    roundName: string,
    matchNumbers: number[],
  ): KnockoutRoundResult {
    this.repo.applyActualResultsToSimulation(simulationId, { sync: false });
    this.repo.syncResolvedParticipants(simulationId);

    const results: KnockoutRoundResult['results'] = [];
    let skipped = 0;

    for (const matchNumber of matchNumbers) {
      if (this.repo.isMatchLocked(matchNumber)) {
        skipped++;
        continue;
      }

      const matchRow = this.repo
        .getSimulationMatches(simulationId)
        .find((m) => m.matchNumber === matchNumber);
      if (!matchRow) {
        throw new SimulationError(`Unknown knockout match: ${matchNumber}`);
      }
      if (matchRow.status === 'played') {
        skipped++;
        continue;
      }

      const homeId = matchRow.teamHomeId;
      const awayId = matchRow.teamAwayId;
      if (homeId == null || awayId == null) {
        throw new SimulationError(`Knockout fixture ${matchNumber} has unresolved participants`);
      }

      const ratings = this.prepareSimulationRatings(simulationId);
      const home = this.simTeamWithRatings(homeId, ratings);
      const away = this.simTeamWithRatings(awayId, ratings);
      const match = simulateMatchOutcome(home, away, true, {
        rng: this.rng,
        upsetVariance: this.upsetVariance,
      });
      const winnerTeamId = match.winnerId ?? null;

      this.repo.persistMatchResult(
        simulationId,
        matchNumber,
        match.goals1,
        match.goals2,
        winnerTeamId,
        { sync: false },
      );

      results.push({
        matchNumber,
        goalsHome: match.goals1,
        goalsAway: match.goals2,
        winnerTeamId,
      });
    }

    this.repo.syncResolvedParticipants(simulationId);

    return {
      simulationId,
      round: roundName,
      matchesPlayed: results.length,
      matchesSkipped: skipped,
      results,
    };
  }
}
