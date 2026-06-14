import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { initSchema } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { Repository } from '../src/db/repository.js';
import { SimulationRunner } from '../src/simulation/runner.js';
import { parseMatchday } from '../src/engine/fixtureOrder.js';

describe('SimulationRunner', () => {
  let repo: Repository;
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    initSchema(sqlite);
    sqlite.exec(`
      INSERT INTO teams (
        id, name, country_code, flag, rank, rating, elo, total, goals_for, goals_against,
        elo_offensive_rating, elo_defensive_rating, goal_offensive_rating, goal_defensive_rating,
        blend_offensive_rating, blend_defensive_rating
      )
      VALUES (1, 'Home', NULL, '', 1, 1500, 1500, 10, 10, 10, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0),
             (2, 'Away', NULL, '', 2, 1500, 1500, 10, 10, 10, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);

      INSERT INTO fixtures (
        match_number, round, date, time, venue, "group",
        slot_home, slot_away, team_home_id, team_away_id
      ) VALUES
        (1, 'Matchday 1', '2026-06-11', '15:00', 'A', 'A', '1', '2', 1, 2),
        (2, 'Matchday 1', '2026-06-11', '18:00', 'B', 'A', '1', '2', 1, 2);
    `);
    repo = new Repository(drizzle(sqlite, { schema }));
  });

  function insertActual(matchNumber: number, goalsHome: number, goalsAway: number): void {
    const winner =
      goalsHome > goalsAway ? 1 : goalsAway > goalsHome ? 2 : null;
    sqlite
      .prepare(
        `INSERT INTO actual_match_results (match_number, goals_home, goals_away, winner_team_id, recorded_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(matchNumber, goalsHome, goalsAway, winner, '2026-06-11T00:00:00Z');
  }

  it('skips locked actual results during group simulation', () => {
    insertActual(1, 2, 1);
    const runner = new SimulationRunner(repo, { random: () => 0.5 });
    const result = runner.simulateGroupPhase();

    expect(result.matchesPlayed).toBe(1);
    expect(result.matchesSkipped).toBe(1);

    const rows = sqlite
      .prepare(
        `SELECT match_number, goals_home, goals_away, status
         FROM simulation_matches
         WHERE simulation_id = ?
         ORDER BY match_number`,
      )
      .all(result.simulationId) as Array<{
      match_number: number;
      goals_home: number;
      goals_away: number;
      status: string;
    }>;

    expect(rows[0].goals_home).toBe(2);
    expect(rows[0].goals_away).toBe(1);
    expect(rows[0].status).toBe('played');
    expect(rows[1].status).toBe('played');
  });
});

describe('SimulationRunner (seeded)', () => {
  let repo: Repository;
  let runner: SimulationRunner;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    initSchema(sqlite);
    seedDatabase(sqlite);
    repo = new Repository(drizzle(sqlite, { schema }));
    runner = new SimulationRunner(repo, { random: () => 0.5 });
  });

  it('simulateGroupPhaseUpTo(1) plays 24 fixtures through MD7', () => {
    const sim = repo.createSimulation('G1');
    const result = runner.simulateGroupPhaseUpTo(sim.id, 1);
    expect(result.matchesPlayed).toBe(24);
    for (const row of result.results) {
      const fixture = repo.getFixtures().find((f) => f.matchNumber === row.matchNumber)!;
      expect(parseMatchday(fixture.round)).toBeLessThanOrEqual(7);
    }
  });

  it('simulateGroupPhaseUpTo(2) plays 48 fixtures through MD13', () => {
    const sim = repo.createSimulation('G2');
    const result = runner.simulateGroupPhaseUpTo(sim.id, 2);
    expect(result.matchesPlayed).toBe(48);
  });

  it('simulateSingleMatch plays one group fixture', () => {
    const sim = repo.createSimulation('One');
    const result = runner.simulateSingleMatch(sim.id, 1);
    expect(result.matchNumber).toBe(1);
    expect(repo.getMatchStatus(sim.id, 1)).toBe('played');
  });

  it('simulateKnockoutsUpTo stops at quarter_final', () => {
    const sim = repo.createSimulation('KO partial');
    runner.simulateGroupPhaseUpTo(sim.id, 3);
    const result = runner.simulateKnockoutsUpTo(sim.id, 'quarter_final');
    expect(result.matchesPlayed).toBe(28);
    expect(result.roundsPlayed).toBe(3);
  });

  it('simulateKnockoutsUpTo completes group stage first when not done', () => {
    const sim = repo.createSimulation('KO from scratch');
    const result = runner.simulateKnockoutsUpTo(sim.id, 'round_of_32');
    expect(result.matchesPlayed).toBe(16);
    expect(result.roundsPlayed).toBe(1);
    expect(repo.getSimulation(sim.id)?.phase).toBe('round_of_32');
  });

  it('simulateKnockoutsUpTo does not resimulate matches that already have results', () => {
    const sim = repo.createSimulation('KO partial replay');
    runner.simulateGroupPhaseUpTo(sim.id, 3);
    runner.simulateKnockoutsUpTo(sim.id, 'round_of_32');

    const before = repo.getSimulationMatches(sim.id).find((m) => m.matchNumber === 73)!;

    const result = runner.simulateKnockoutsUpTo(sim.id, 'round_of_16');
    expect(result.matchesPlayed).toBe(8);

    const after = repo.getSimulationMatches(sim.id).find((m) => m.matchNumber === 73)!;

    expect(after.goalsHome).toBe(before.goalsHome);
    expect(after.goalsAway).toBe(before.goalsAway);
  });

  it('updates tournament elo deltas after group round 1 before round 2', () => {
    const sim = repo.createSimulation('G1 Elo');
    runner.simulateGroupPhaseUpTo(sim.id, 1);
    const deltas = repo.getTournamentEloDeltas(sim.id);
    const winners = [...deltas.entries()].filter(([, delta]) => delta > 0);
    const losers = [...deltas.entries()].filter(([, delta]) => delta < 0);
    expect(winners.length).toBeGreaterThan(0);
    expect(losers.length).toBeGreaterThan(0);
  });

  it('updates tournament elo deltas after knockout rounds', () => {
    const sim = repo.createSimulation('KO Elo');
    runner.simulateGroupPhaseUpTo(sim.id, 3);
    const beforeKnockout = repo.getTournamentEloDeltas(sim.id);
    runner.simulateKnockoutsUpTo(sim.id, 'round_of_32');
    const afterKnockout = repo.getTournamentEloDeltas(sim.id);
    const changed = [...afterKnockout.entries()].some(([teamId, delta]) => {
      return Math.abs(delta - (beforeKnockout.get(teamId) ?? 0)) > 1e-6;
    });
    expect(changed).toBe(true);
  });
});
