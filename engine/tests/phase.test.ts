import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { initSchema } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { Repository } from '../src/db/repository.js';
import { SimulationRunner } from '../src/simulation/runner.js';
import {
  canClearActualResult,
  canClearSimulationResult,
  canModifySimulationResult,
  computeActualPhase,
  getFixtureResultPhase,
  isGroupStagePhase,
  isKnockoutStagePhase,
} from '../src/engine/phase.js';

describe('simulation phase checkpoints', () => {
  let repo: Repository;
  let runner: SimulationRunner;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    initSchema(sqlite);
    seedDatabase(sqlite);
    repo = new Repository(drizzle(sqlite, { schema }));
    runner = new SimulationRunner(repo);
  });

  it('starts at group', () => {
    const sim = repo.createSimulation('Fresh');
    const state = repo.buildTournamentState(sim.id)!;
    expect(state.simulation.phase).toBe('group');
    expect(isGroupStagePhase(state.simulation.phase)).toBe(true);
  });

  it('advances to g1 after simulating first group checkpoint', () => {
    const sim = repo.createSimulation('G1');
    runner.simulateGroupPhaseUpTo(sim.id, 1);
    const state = repo.buildTournamentState(sim.id)!;
    expect(state.simulation.phase).toBe('g1');
  });

  it('advances to g3 when group stage is complete', () => {
    const sim = repo.createSimulation('Full group');
    const fixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of fixtures) {
      repo.updateMatchResult(sim.id, f.matchNumber, 1, 0, f.teamHomeId);
    }
    const state = repo.buildTournamentState(sim.id)!;
    expect(state.simulation.phase).toBe('g3');
    expect(isKnockoutStagePhase(state.simulation.phase)).toBe(true);
  });

  it('advances to complete when final is played', () => {
    const sim = repo.createSimulation('Champion');
    runner.simulateGroupPhaseUpTo(sim.id, 3);
    runner.simulateKnockoutsUpTo(sim.id);
    const state = repo.buildTournamentState(sim.id)!;
    expect(state.simulation.phase).toBe('complete');
  });

  it('canModifySimulationResult allows same-round edits but blocks earlier rounds', () => {
    const fixtures = repo.getFixtures();
    const sim = repo.createSimulation('Modify rules');
    runner.simulateGroupPhaseUpTo(sim.id, 3);
    runner.simulateKnockoutsUpTo(sim.id, 'final');
    const matches = repo.getSimulationMatches(sim.id);

    expect(canModifySimulationResult(97, matches, fixtures)).toBe(false);
    expect(canModifySimulationResult(104, matches, fixtures)).toBe(true);
  });

  it('canModifySimulationResult treats third place and final as the same round', () => {
    const fixtures = repo.getFixtures();
    const sim = repo.createSimulation('Finals pair');
    runner.simulateGroupPhaseUpTo(sim.id, 3);
    runner.simulateKnockoutsUpTo(sim.id, 'semi_final');
    repo.updateMatchResult(sim.id, 104, 2, 1, 18);
    const matches = repo.getSimulationMatches(sim.id);

    expect(canModifySimulationResult(103, matches, fixtures)).toBe(true);
    expect(canModifySimulationResult(104, matches, fixtures)).toBe(true);
  });

  it('advances to quarter_final when simulating knockouts through that round', () => {
    const sim = repo.createSimulation('Partial KO');
    runner.simulateGroupPhaseUpTo(sim.id, 3);
    runner.simulateKnockoutsUpTo(sim.id, 'quarter_final');
    const state = repo.buildTournamentState(sim.id)!;
    expect(state.simulation.phase).toBe('quarter_final');
  });
});

describe('actual result phase', () => {
  let repo: Repository;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    initSchema(sqlite);
    seedDatabase(sqlite);
    repo = new Repository(drizzle(sqlite, { schema }));
  });

  it('computeActualPhase starts at group with no results', () => {
    const fixtures = repo.getFixtures();
    expect(computeActualPhase([], fixtures)).toBe('group');
  });

  it('computeActualPhase advances through g1 when first checkpoint is complete', () => {
    const fixtures = repo.getFixtures();
    const g1 = fixtures.filter((f) => f.group && getFixtureResultPhase(f) === 'group');
    const actuals = g1.map((f) => ({
      matchNumber: f.matchNumber,
      goalsHome: 1,
      goalsAway: 0,
      winnerTeamId: f.teamHomeId,
    }));
    expect(computeActualPhase(actuals, fixtures)).toBe('g1');
  });

  it('canClearActualResult allows same-round clears but blocks earlier rounds', () => {
    const fixtures = repo.getFixtures();
    repo.setActualResult(1, 2, 1, 18);
    repo.setActualResult(2, 1, 0, 32);
    const actuals = repo.getActualResults();

    expect(canClearActualResult(1, actuals, fixtures)).toBe(true);
    expect(canClearActualResult(2, actuals, fixtures)).toBe(true);

    const g2Fixture = fixtures.find((f) => f.matchNumber === 3)!;
    repo.setActualResult(3, 1, 0, g2Fixture.teamHomeId);
    const withG2 = repo.getActualResults();
    expect(canClearActualResult(1, withG2, fixtures)).toBe(false);
    expect(canClearActualResult(3, withG2, fixtures)).toBe(true);
  });

  it('canClearSimulationResult allows same-round clears but blocks earlier rounds', () => {
    const fixtures = repo.getFixtures();
    const sim = repo.createSimulation('Clear rules');
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    repo.updateMatchResult(sim.id, 2, 1, 0, 32);
    let matches = repo.getSimulationMatches(sim.id);

    expect(canClearSimulationResult(1, matches, fixtures)).toBe(true);
    expect(canClearSimulationResult(2, matches, fixtures)).toBe(true);

    const g2Fixture = fixtures.find((f) => f.matchNumber === 3)!;
    repo.updateMatchResult(sim.id, 3, 1, 0, g2Fixture.teamHomeId!);
    matches = repo.getSimulationMatches(sim.id);
    expect(canClearSimulationResult(1, matches, fixtures)).toBe(false);
    expect(canClearSimulationResult(3, matches, fixtures)).toBe(true);
  });

  it('canClearActualResult allows clearing knockout results in the latest played round', () => {
    const fixtures = repo.getFixtures();
    for (const f of fixtures.filter((fixture) => fixture.group != null)) {
      repo.setActualResult(f.matchNumber, 1, 0, f.teamHomeId);
    }
    repo.setActualResult(73, 2, 1, null);
    const actuals = repo.getActualResults();
    expect(canClearActualResult(73, actuals, fixtures)).toBe(true);

    repo.setActualResult(74, 1, 0, null);
    const withSameRound = repo.getActualResults();
    expect(canClearActualResult(73, withSameRound, fixtures)).toBe(true);
    expect(canClearActualResult(74, withSameRound, fixtures)).toBe(true);
  });
});
