import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as schema from './schema.js';
import { SIMULATION_KNOCKOUT_ROUNDS } from '../engine/simulationRounds.js';
import type { PredictionKnockoutResult } from '../engine/predictionKnockout.js';
import type { Repository } from './repository.js';
import { readPredictionKnockoutResults } from './predictionKnockoutStorage.js';

const KNOCKOUT_RUN_MARKER = 'Knockout — ';

export function knockoutRunPrefix(predictionName: string): string {
  return `${KNOCKOUT_RUN_MARKER}${predictionName} #`;
}

export function isKnockoutRunSimulationName(name: string): boolean {
  return name.startsWith(KNOCKOUT_RUN_MARKER) || name.startsWith('Knockout snapshot — ');
}

export function isKnockoutRunSimulationId(repo: Repository, simulationId: number): boolean {
  const simulation = repo.getSimulation(simulationId);
  return simulation != null && isKnockoutRunSimulationName(simulation.name);
}

/** Keep derived knockout run sims out of prediction pool aggregates. */
export const KNOCKOUT_RUN_SIMULATION_SQL = `sm.simulation_id NOT IN (
  SELECT id FROM simulations
  WHERE name LIKE 'Knockout — %' OR name LIKE 'Knockout snapshot — %'
)`;

function listKnockoutMatchNumbers(): number[] {
  return SIMULATION_KNOCKOUT_ROUNDS.flatMap((round) => [...round.matches]);
}

function nextKnockoutRunName(repo: Repository, predictionName: string): string {
  const prefix = knockoutRunPrefix(predictionName);
  const count = repo
    .listSimulations()
    .filter((simulation) => simulation.name.startsWith(prefix)).length;
  return `${prefix}${count + 1}`;
}

function writePlayedMatch(
  db: Db,
  simulationId: number,
  matchNumber: number,
  goalsHome: number,
  goalsAway: number,
  winnerTeamId: number | null,
  penGoals?: { penGoalsHome?: number | null; penGoalsAway?: number | null },
): void {
  db.update(schema.simulationMatches)
    .set({
      goalsHome,
      goalsAway,
      penGoalsHome: penGoals?.penGoalsHome ?? null,
      penGoalsAway: penGoals?.penGoalsAway ?? null,
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
}

function writeKnockoutResultsToRun(
  db: Db,
  repo: Repository,
  simulationId: number,
  results: PredictionKnockoutResult[],
): void {
  for (const result of results) {
    if (repo.isMatchLocked(result.matchNumber)) continue;
    writePlayedMatch(db, simulationId, result.matchNumber, result.goalsHome, result.goalsAway, result.winnerTeamId, {
      penGoalsHome: result.penGoalsHome,
      penGoalsAway: result.penGoalsAway,
    });
  }
}

export function readKnockoutResultsFromSimulation(
  repo: Repository,
  simulationId: number,
): PredictionKnockoutResult[] {
  const matches = repo.getSimulationMatches(simulationId);
  const byNumber = new Map(matches.map((match) => [match.matchNumber, match]));
  const results: PredictionKnockoutResult[] = [];

  for (const matchNumber of listKnockoutMatchNumbers()) {
    const match = byNumber.get(matchNumber);
    if (
      match?.status !== 'played' ||
      match.goalsHome == null ||
      match.goalsAway == null ||
      match.winnerTeamId == null
    ) {
      continue;
    }
    results.push({
      matchNumber,
      goalsHome: match.goalsHome,
      goalsAway: match.goalsAway,
      winnerTeamId: match.winnerTeamId,
      penGoalsHome: match.penGoalsHome,
      penGoalsAway: match.penGoalsAway,
    });
  }

  return results;
}

export function listKnockoutRunsForPrediction(
  repo: Repository,
  predictionId: number,
): Array<{ id: number; name: string }> {
  const prediction = repo.getPrediction(predictionId);
  if (!prediction) return [];

  const prefix = knockoutRunPrefix(prediction.name);
  const legacyName = `Knockout snapshot — ${prediction.name}`;
  return repo
    .listSimulations()
    .filter(
      (simulation) =>
        simulation.name.startsWith(prefix) || simulation.name === legacyName,
    )
    .sort((a, b) => a.id - b.id)
    .map((simulation) => ({ id: simulation.id, name: simulation.name }));
}

export function setActiveKnockoutSimulation(
  db: Db,
  repo: Repository,
  predictionId: number,
  simulationId: number | null,
): void {
  if (simulationId != null) {
    const prediction = repo.getPrediction(predictionId);
    if (!prediction) {
      throw new Error(`Prediction not found: ${predictionId}`);
    }
    if (!isKnockoutRunSimulationId(repo, simulationId)) {
      throw new Error(`Simulation ${simulationId} is not a knockout run for this prediction`);
    }
    const simulation = repo.getSimulation(simulationId)!;
    const prefix = knockoutRunPrefix(prediction.name);
    const legacyName = `Knockout snapshot — ${prediction.name}`;
    if (!simulation.name.startsWith(prefix) && simulation.name !== legacyName) {
      throw new Error(`Simulation ${simulationId} does not belong to prediction ${predictionId}`);
    }
  }

  db.update(schema.predictions)
    .set({
      activeKnockoutSimulationId: simulationId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.predictions.id, predictionId))
    .run();
}

export function clearActiveKnockoutSimulation(db: Db, predictionId: number): void {
  db.update(schema.predictions)
    .set({
      activeKnockoutSimulationId: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.predictions.id, predictionId))
    .run();
}

/** Persist the current prediction knockout path as a new loadable simulation run. */
export function createPredictionKnockoutRun(
  db: Db,
  repo: Repository,
  predictionId: number,
): number {
  const prediction = repo.getPrediction(predictionId);
  if (!prediction) {
    throw new Error(`Prediction not found: ${predictionId}`);
  }

  const simulationId = repo.createSimulation(nextKnockoutRunName(repo, prediction.name), {
    deferMasterStats: true,
  }).id;

  // Group scores come from actual results applied in createSimulation; only knockout
  // predictions are written here (actual knockouts remain from applyActualResults).
  writeKnockoutResultsToRun(db, repo, simulationId, readPredictionKnockoutResults(db, predictionId));

  repo.touchSimulation(simulationId);
  repo.syncResolvedParticipants(simulationId, { refreshMasterStats: false });
  repo.recomputeTournamentEloDeltas(simulationId);
  setActiveKnockoutSimulation(db, repo, predictionId, simulationId);

  return simulationId;
}
