import type { Repository } from '../db/repository.js';
import type { Simulation } from '../engine/types.js';
import type {
  GroupPhaseResult,
  KnockoutsResult,
  MatchResultRow,
} from '../engine/matchSimulator.js';
import {
  GROUP_GAMES_MATCHDAY_CUTOFF,
  type GroupGamesTarget,
} from '../engine/groupSimulation.js';
import { SIMULATION_KNOCKOUT_ROUNDS } from '../engine/simulationRounds.js';
import { SimulationRunner, SimulationError } from '../simulation/runner.js';
import { ApiError } from './errors.js';

export interface SimulateGroupResponse extends GroupPhaseResult {
  simulation: Simulation;
}

export interface SimulateKnockoutsResponse extends KnockoutsResult {
  simulation: Simulation;
}

export interface SimulateMatchResponse extends MatchResultRow {
  simulation: Simulation;
}

function mapSimulationError(err: unknown): never {
  if (err instanceof SimulationError) {
    throw new ApiError(err.message, 409, 'simulation_error');
  }
  throw err;
}

export function parseGroupGamesParam(value: string | undefined): GroupGamesTarget {
  if (value == null || value === '') return 3;
  const n = parseInt(value, 10);
  if (n !== 1 && n !== 2 && n !== 3) {
    throw new ApiError('games must be 1, 2, or 3', 400, 'invalid_param');
  }
  return n as GroupGamesTarget;
}

export function parseThroughRoundParam(value: string | undefined): string | undefined {
  if (value == null || value === '') return undefined;
  const valid = SIMULATION_KNOCKOUT_ROUNDS.some((r) => r.name === value);
  if (!valid) {
    throw new ApiError('Invalid knockout round', 400, 'invalid_param');
  }
  return value;
}

export function simulateGroupPhase(
  repo: Repository,
  simulationId?: number,
  gamesTarget: GroupGamesTarget = 3,
): SimulateGroupResponse {
  const runner = new SimulationRunner(repo);
  try {
    const result =
      simulationId != null
        ? runner.simulateGroupPhaseUpTo(simulationId, gamesTarget)
        : runner.simulateGroupPhaseUpTo(undefined, gamesTarget);
    const simulation = repo.getSimulation(result.simulationId);
    if (!simulation) {
      throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    }
    return { ...result, simulation };
  } catch (err) {
    mapSimulationError(err);
  }
}

export function simulateGroupPhaseAuto(
  repo: Repository,
  gamesTarget: GroupGamesTarget = 3,
): SimulateGroupResponse {
  const runner = new SimulationRunner(repo);
  const simulationId = repo.chooseSimulationForGroupPhase();
  try {
    const result = runner.simulateGroupPhaseUpTo(simulationId, gamesTarget);
    const simulation = repo.getSimulation(result.simulationId);
    if (!simulation) {
      throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    }
    return { ...result, simulation };
  } catch (err) {
    mapSimulationError(err);
  }
}

export function simulateKnockouts(
  repo: Repository,
  simulationId?: number,
  throughRound?: string,
): SimulateKnockoutsResponse {
  const runner = new SimulationRunner(repo);
  try {
    const result = runner.simulateKnockoutsUpTo(simulationId, throughRound);
    const simulation = repo.getSimulation(result.simulationId);
    if (!simulation) {
      throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    }
    return { ...result, simulation };
  } catch (err) {
    mapSimulationError(err);
  }
}

export function simulateMatch(
  repo: Repository,
  simulationId: number,
  matchNumber: number,
): SimulateMatchResponse {
  const runner = new SimulationRunner(repo);
  try {
    const result = runner.simulateSingleMatch(simulationId, matchNumber);
    const simulation = repo.getSimulation(simulationId);
    if (!simulation) {
      throw new ApiError('Simulation not found', 404, 'simulation_not_found');
    }
    return { ...result, simulation };
  } catch (err) {
    mapSimulationError(err);
  }
}

export { GROUP_GAMES_MATCHDAY_CUTOFF };
