import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as schema from './schema.js';
import { SIMULATION_KNOCKOUT_ROUNDS } from '../engine/simulationRounds.js';
import type { Repository } from './repository.js';
import { readPredictionKnockoutResults } from './predictionKnockoutStorage.js';

export function knockoutSnapshotSimulationName(predictionName: string): string {
  return `Knockout snapshot — ${predictionName}`;
}

function listKnockoutMatchNumbers(): number[] {
  return SIMULATION_KNOCKOUT_ROUNDS.flatMap((round) => [...round.matches]);
}

function isKnockoutSnapshotSimulation(name: string): boolean {
  return name.startsWith('Knockout snapshot — ');
}

export function isKnockoutSnapshotSimulationId(repo: Repository, simulationId: number): boolean {
  const simulation = repo.getSimulation(simulationId);
  return simulation != null && isKnockoutSnapshotSimulation(simulation.name);
}

/** Keep derived knockout snapshot sims out of prediction pool aggregates. */
export const KNOCKOUT_SNAPSHOT_SIMULATION_SQL =
  `sm.simulation_id NOT IN (SELECT id FROM simulations WHERE name LIKE 'Knockout snapshot — %')`;

function ensureSnapshotSimulation(repo: Repository, predictionId: number): number | null {
  const prediction = repo.getPrediction(predictionId);
  if (!prediction) return null;

  const name = knockoutSnapshotSimulationName(prediction.name);
  const existing = repo.listSimulations().find((simulation) => simulation.name === name);
  if (existing) return existing.id;

  return repo.createSimulation(name, { deferMasterStats: true }).id;
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

function seedSnapshotGroupFromMaster(repo: Repository, db: Db, predictionId: number, simulationId: number): void {
  const masterGroup = repo.buildMasterGroupView(predictionId);
  for (const match of masterGroup.resolvedMatches) {
    if (match.fixture.group == null) continue;
    if (match.result.status !== 'played') continue;
    if (match.result.goalsHome == null || match.result.goalsAway == null) continue;
    if (repo.isMatchLocked(match.fixture.matchNumber)) continue;

    writePlayedMatch(
      db,
      simulationId,
      match.fixture.matchNumber,
      match.result.goalsHome,
      match.result.goalsAway,
      match.result.winnerTeamId,
    );
  }
}

function clearSnapshotKnockoutMatches(db: Db, repo: Repository, simulationId: number): void {
  for (const matchNumber of listKnockoutMatchNumbers()) {
    if (repo.isMatchLocked(matchNumber)) continue;
    db.update(schema.simulationMatches)
      .set({
        goalsHome: null,
        goalsAway: null,
        penGoalsHome: null,
        penGoalsAway: null,
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
  }
}

/** Mirror prediction knockout consensus into a dedicated simulation row set. */
export function syncPredictionKnockoutSnapshot(
  db: Db,
  repo: Repository,
  predictionId: number,
): void {
  const simulationId = ensureSnapshotSimulation(repo, predictionId);
  if (simulationId == null) return;

  seedSnapshotGroupFromMaster(repo, db, predictionId, simulationId);
  clearSnapshotKnockoutMatches(db, repo, simulationId);

  const results = readPredictionKnockoutResults(db, predictionId);
  for (const result of results) {
    if (repo.isMatchLocked(result.matchNumber)) continue;
    writePlayedMatch(db, simulationId, result.matchNumber, result.goalsHome, result.goalsAway, result.winnerTeamId, {
      penGoalsHome: result.penGoalsHome,
      penGoalsAway: result.penGoalsAway,
    });
  }

  repo.touchSimulation(simulationId);
  repo.syncResolvedParticipants(simulationId, { refreshMasterStats: false });
  repo.recomputeTournamentEloDeltas(simulationId);
}

export function clearPredictionKnockoutSnapshot(
  db: Db,
  repo: Repository,
  predictionId: number,
): void {
  const prediction = repo.getPrediction(predictionId);
  if (!prediction) return;

  const name = knockoutSnapshotSimulationName(prediction.name);
  const existing = repo.listSimulations().find((simulation) => simulation.name === name);
  if (!existing) return;

  clearSnapshotKnockoutMatches(db, repo, existing.id);
  repo.touchSimulation(existing.id);
  repo.syncResolvedParticipants(existing.id, { refreshMasterStats: false });
  repo.recomputeTournamentEloDeltas(existing.id);
}
