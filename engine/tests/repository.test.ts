import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { initSchema } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { Repository } from '../src/db/repository.js';
import { readPredictionKnockoutResults } from '../src/db/predictionKnockoutStorage.js';

function ensureTestPrediction(repo: Repository, maxId = 9999): number {
  const existing = repo.getActivePrediction();
  if (existing) return existing.id;
  if (repo.listSimulations().length === 0) {
    repo.createSimulation('Seed');
  }
  return repo.createPrediction('Test pool', `1-${maxId}`).id;
}

describe('repository integration', () => {
  let repo: Repository;
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    initSchema(sqlite);
    seedDatabase(sqlite);
    repo = new Repository(drizzle(sqlite, { schema }));
  });

  it('updates blend ratings when rating elo weight changes', () => {
    const spain = repo.getTeams().find((t) => t.name === 'Spain')!;
    const before = spain.blendOffensiveRating;
    repo.setRatingEloWeight(0);
    const reloaded = repo.getTeams().find((t) => t.id === spain.id)!;
    expect(reloaded.blendOffensiveRating).not.toBe(before);
    expect(repo.getRatingEloWeight()).toBe(0);
  });

  it('creates simulation with 104 match rows', () => {
    const sim = repo.createSimulation('Test');
    const matches = repo.getSimulationMatches(sim.id);
    expect(matches).toHaveLength(104);
    expect(matches.every((m) => m.status === 'scheduled')).toBe(true);
    const groupMatch = matches.find((m) => m.matchNumber === 1)!;
    expect(groupMatch.teamHomeId).not.toBeNull();
    expect(groupMatch.teamAwayId).not.toBeNull();
  });

  it('updates group standings after results', () => {
    const sim = repo.createSimulation('Test');
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    const state = repo.buildTournamentState(sim.id)!;
    const groupA = state.groupStandings.find((g) => g.groupLetter === 'A')!;
    const mexico = groupA.rows.find((r) => r.team.name === 'Mexico')!;
    expect(mexico.points).toBe(3);
    expect(mexico.goalsFor).toBe(2);
  });

  it('clears a played match back to scheduled', () => {
    const sim = repo.createSimulation('Test');
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    repo.clearMatchResult(sim.id, 1);
    const match = repo.getSimulationMatches(sim.id).find((m) => m.matchNumber === 1)!;
    expect(match.status).toBe('scheduled');
    expect(match.goalsHome).toBeNull();
    expect(match.goalsAway).toBeNull();
    const state = repo.buildTournamentState(sim.id)!;
    const groupA = state.groupStandings.find((g) => g.groupLetter === 'A')!;
    const mexico = groupA.rows.find((r) => r.team.name === 'Mexico')!;
    expect(mexico.points).toBe(0);
  });

  it('renames and deletes simulations', () => {
    const sim = repo.createSimulation('Old name');
    repo.updateMatchResult(sim.id, 1, 1, 0, 18);
    const renamed = repo.updateSimulationName(sim.id, 'New name');
    expect(renamed?.name).toBe('New name');

    const other = repo.createSimulation('Keep');
    expect(repo.deleteSimulation(sim.id)).toBe(true);
    expect(repo.getSimulation(sim.id)).toBeNull();
    expect(repo.listSimulations()).toHaveLength(2);
    expect(repo.listSimulations().map((s) => s.id).sort()).toEqual([1, other.id]);
  });

  it('returns the most recently edited simulation', () => {
    const first = repo.createSimulation('First');
    const second = repo.createSimulation('Second');
    repo.updateMatchResult(first.id, 1, 1, 0, 18);
    expect(repo.getLastEditedSimulation()?.id).toBe(first.id);
    repo.updateMatchResult(second.id, 1, 2, 1, 18);
    expect(repo.getLastEditedSimulation()?.id).toBe(second.id);
  });

  it('reuses the lowest unused simulation id after deletion', () => {
    const first = repo.createSimulation('One');
    expect(first.id).toBe(2);
    repo.createSimulation('Two');
    repo.createSimulation('Three');
    repo.deleteSimulation(2);
    const next = repo.createSimulation('Four');
    expect(next.id).toBe(2);
  });

  it('persists resolved participants on simulation_matches', () => {
    const sim = repo.createSimulation('Full group');
    const fixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of fixtures) {
      repo.updateMatchResult(sim.id, f.matchNumber, 1, 0, f.teamHomeId);
    }

    const r32 = repo.getSimulationMatches(sim.id).find((m) => m.matchNumber === 73)!;
    expect(r32.teamHomeId).not.toBeNull();
    expect(r32.teamAwayId).not.toBeNull();

    const state = repo.buildTournamentState(sim.id)!;
    const resolved = state.resolvedMatches.find((m) => m.fixture.matchNumber === 73)!;
    expect(resolved.homeTeam?.id).toBe(r32.teamHomeId);
    expect(resolved.awayTeam?.id).toBe(r32.teamAwayId);
  });

  it('transitions to knockout when group stage complete', () => {
    const sim = repo.createSimulation('Full group');
    const fixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of fixtures) {
      repo.updateMatchResult(sim.id, f.matchNumber, 1, 0, f.teamHomeId);
    }
    const state = repo.buildTournamentState(sim.id)!;
    expect(state.simulation.phase).toBe('g3');
    expect(state.annexCCombinationId).not.toBeNull();
    const r32 = state.resolvedMatches.find((m) => m.fixture.matchNumber === 73)!;
    expect(r32.homeTeam).not.toBeNull();
    expect(r32.awayTeam).not.toBeNull();
  });

  it('prefers actual results over simulation predictions in group standings', () => {
    const sim = repo.createSimulation('Predictions');
    repo.updateMatchResult(sim.id, 1, 0, 1, 32);
    repo.setActualResult(1, 2, 1, 18);
    const state = repo.buildTournamentState(sim.id)!;
    const groupA = state.groupStandings.find((g) => g.groupLetter === 'A')!;
    const mexico = groupA.rows.find((r) => r.team.name === 'Mexico')!;
    const southAfrica = groupA.rows.find((r) => r.team.name === 'South Africa')!;
    expect(mexico.points).toBe(3);
    expect(mexico.goalsFor).toBe(2);
    expect(southAfrica.points).toBe(0);
    expect(southAfrica.goalsFor).toBe(1);
  });

  it('applies actual results when creating a simulation', () => {
    repo.setActualResult(1, 2, 1, 18);
    const sim = repo.createSimulation('With actuals');
    const match = repo.getSimulationMatches(sim.id).find((m) => m.matchNumber === 1)!;
    expect(match.status).toBe('played');
    expect(match.goalsHome).toBe(2);
    expect(match.goalsAway).toBe(1);
    expect(match.winnerTeamId).toBe(18);
  });

  it('blocks simulation score edits on locked matches', () => {
    repo.setActualResult(1, 2, 1, 18);
    const sim = repo.createSimulation('Locked');
    expect(() => repo.updateMatchResult(sim.id, 1, 0, 0, null)).toThrow(/locked/);
    expect(() => repo.clearMatchResult(sim.id, 1)).toThrow(/locked/);
  });

  it('blocks changing simulation results when later round results exist', () => {
    const sim = repo.createSimulation('Cascade');
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    repo.updateMatchResult(sim.id, 2, 1, 0, 32);
    const g2Fixture = repo.getFixtures().find((f) => f.matchNumber === 3)!;
    repo.updateMatchResult(sim.id, 3, 1, 0, g2Fixture.teamHomeId!);

    expect(() => repo.updateMatchResult(sim.id, 1, 0, 0, null)).toThrow(/later tournament round/);
    expect(() => repo.clearMatchResult(sim.id, 1)).toThrow(/later tournament round/);
    repo.clearMatchResult(sim.id, 3);
    repo.clearMatchResult(sim.id, 1);
    const match = repo.getSimulationMatches(sim.id).find((m) => m.matchNumber === 1)!;
    expect(match.status).toBe('scheduled');
  });

  it('clears actual results and leaves new simulations scheduled', () => {
    repo.setActualResult(1, 2, 1, 18);
    repo.clearActualResult(1);
    expect(repo.isMatchLocked(1)).toBe(false);
    const sim = repo.createSimulation('After clear');
    const match = repo.getSimulationMatches(sim.id).find((m) => m.matchNumber === 1)!;
    expect(match.status).toBe('scheduled');
  });

  it('corrects actual results for future simulations', () => {
    repo.setActualResult(1, 2, 1, 18);
    repo.createSimulation('Old');
    repo.setActualResult(1, 3, 0, 18);
    const sim = repo.createSimulation('New');
    const match = repo.getSimulationMatches(sim.id).find((m) => m.matchNumber === 1)!;
    expect(match.goalsHome).toBe(3);
    expect(match.goalsAway).toBe(0);
  });

  it('allows clearing same-round actual results', () => {
    repo.setActualResult(1, 2, 1, 18);
    repo.setActualResult(2, 1, 0, 32);
    repo.clearActualResult(1);
    expect(repo.getActualResult(1)).toBeNull();
    expect(repo.getActualResult(2)?.goalsHome).toBe(1);
  });

  it('blocks clearing upstream actual when later-round actuals exist', () => {
    const g2Fixture = repo.getFixtures().find((f) => f.matchNumber === 3)!;
    repo.setActualResult(1, 2, 1, 18);
    repo.setActualResult(3, 1, 0, g2Fixture.teamHomeId);
    expect(() => repo.clearActualResult(1)).toThrow(/later tournament round/);
  });

  it('preserves actual results across re-seed', () => {
    repo.setActualResult(1, 2, 1, 18);
    seedDatabase(sqlite);
    expect(repo.getActualResult(1)?.goalsHome).toBe(2);
  });

  it('stores tournament elo deltas only for teams that played', () => {
    const sim = repo.createSimulation('Elo');
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    const deltas = repo.getTournamentEloDeltas(sim.id);
    expect(deltas.size).toBe(2);
    expect((deltas.get(18) ?? 0) > 0).toBe(true);
    expect((deltas.get(78) ?? 0) < 0).toBe(true);
  });

  it('rolls back tournament elo deltas when a match is cleared', () => {
    const sim = repo.createSimulation('Elo clear');
    repo.updateMatchResult(sim.id, 1, 2, 1, 18);
    expect((repo.getTournamentEloDeltas(sim.id).get(18) ?? 0) > 0).toBe(true);
    repo.clearMatchResult(sim.id, 1);
    expect(repo.getTournamentEloDeltas(sim.id).size).toBe(0);
  });

  it('includes locked actual results in tournament elo deltas', () => {
    repo.setActualResult(1, 2, 1, 18);
    const sim = repo.createSimulation('Actual Elo');
    const deltas = repo.getTournamentEloDeltas(sim.id);
    expect((deltas.get(18) ?? 0) > 0).toBe(true);
    expect((deltas.get(78) ?? 0) < 0).toBe(true);
  });

  it('master group standings prefer actual results over consensus', () => {
    repo.setActualResult(1, 2, 1, 18);
    const sim = repo.createSimulation('Consensus clash');
    repo.updateMatchResult(sim.id, 2, 0, 2, 19);
    const predictionId = ensureTestPrediction(repo);
    repo.rebuildAllPredictionAggregates();

    const master = repo.buildMasterGroupView(predictionId);
    const groupA = master.groupStandings.find((g) => g.groupLetter === 'A')!;
    const mexico = groupA.rows.find((r) => r.team.name === 'Mexico')!;
    const southAfrica = groupA.rows.find((r) => r.team.name === 'South Africa')!;

    expect(mexico.points).toBe(3);
    expect(mexico.goalsFor).toBe(2);
    expect(southAfrica.points).toBe(0);
    expect(southAfrica.goalsFor).toBe(1);
  });

  it('creates loadable knockout runs like bulk simulations', () => {
    const sim = repo.createSimulation('Full group');
    const groupFixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of groupFixtures) {
      repo.updateMatchResult(sim.id, f.matchNumber, 1, 0, f.teamHomeId!);
    }

    const predictionId = ensureTestPrediction(repo);
    repo.rebuildAllPredictionAggregates();
    repo.simulatePredictionKnockoutRoundForPrediction(predictionId, 'round_of_32', { count: 100 });

    const prediction = repo.getPrediction(predictionId)!;
    const viewAfterFirst = repo.buildMasterKnockoutView(predictionId);
    expect(viewAfterFirst.knockoutRuns).toHaveLength(1);
    expect(viewAfterFirst.knockoutRuns[0]!.name).toBe(`Knockout — ${prediction.name} #1`);
    expect(viewAfterFirst.activeKnockoutSimulationId).toBe(viewAfterFirst.knockoutRuns[0]!.id);

    const firstRunId = viewAfterFirst.knockoutRuns[0]!.id;
    const r32First = repo.getSimulationMatches(firstRunId).find((m) => m.matchNumber === 73)!;
    expect(r32First.status).toBe('played');

    repo.simulatePredictionKnockoutRoundForPrediction(predictionId, 'round_of_32', {
      count: 100,
      resimulate: true,
    });

    const viewAfterSecond = repo.buildMasterKnockoutView(predictionId);
    expect(viewAfterSecond.knockoutRuns).toHaveLength(1);
    expect(viewAfterSecond.activeKnockoutSimulationId).toBe(viewAfterFirst.knockoutRuns[0]!.id);

    repo.setPredictionActiveKnockoutSimulation(predictionId, firstRunId);
    const loadedFirst = repo.buildMasterKnockoutView(predictionId);
    expect(loadedFirst.activeKnockoutSimulationId).toBe(firstRunId);
    const latestR32 = viewAfterSecond.resolvedMatches.find((m) => m.fixture.matchNumber === 73)!;
    const loadedR32 = loadedFirst.resolvedMatches.find((m) => m.fixture.matchNumber === 73)!;
    expect(loadedR32.result.goalsHome).toBe(latestR32.result.goalsHome);
    expect(loadedR32.result.goalsAway).toBe(latestR32.result.goalsAway);
  });

  it('knockout runs seed group scores from actual results only', () => {
    const sim = repo.createSimulation('Full group');
    const groupFixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of groupFixtures) {
      repo.updateMatchResult(sim.id, f.matchNumber, 1, 0, f.teamHomeId!);
    }

    const predictionId = ensureTestPrediction(repo);
    repo.rebuildAllPredictionAggregates();

    const sampleGroup = groupFixtures[0]!;
    const sampleGroup2 = groupFixtures[1]!;
    repo.setActualResult(sampleGroup.matchNumber, 2, 1, sampleGroup.teamHomeId!);
    repo.setActualResult(sampleGroup2.matchNumber, 0, 3, sampleGroup2.teamAwayId!);

    repo.simulatePredictionKnockoutRoundForPrediction(predictionId, 'round_of_32', { count: 100 });

    const runId = repo.buildMasterKnockoutView(predictionId).knockoutRuns[0]!.id;
    const runMatches = repo.getSimulationMatches(runId);

    const actualGroup1 = runMatches.find((m) => m.matchNumber === sampleGroup.matchNumber)!;
    expect(actualGroup1.status).toBe('played');
    expect(actualGroup1.goalsHome).toBe(2);
    expect(actualGroup1.goalsAway).toBe(1);

    const actualGroup2 = runMatches.find((m) => m.matchNumber === sampleGroup2.matchNumber)!;
    expect(actualGroup2.status).toBe('played');
    expect(actualGroup2.goalsHome).toBe(0);
    expect(actualGroup2.goalsAway).toBe(3);

    const unplayedGroup = runMatches.find(
      (m) =>
        groupFixtures.some((f) => f.matchNumber === m.matchNumber) &&
        m.matchNumber !== sampleGroup.matchNumber &&
        m.matchNumber !== sampleGroup2.matchNumber,
    )!;
    expect(unplayedGroup.status).toBe('scheduled');
    expect(unplayedGroup.goalsHome).toBeNull();
  });

  it('backfills a knockout run when results exist but no saved run', () => {
    const sim = repo.createSimulation('Full group');
    const groupFixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of groupFixtures) {
      repo.updateMatchResult(sim.id, f.matchNumber, 1, 0, f.teamHomeId!);
    }

    const predictionId = ensureTestPrediction(repo);
    repo.rebuildAllPredictionAggregates();
    repo.simulatePredictionKnockoutRoundForPrediction(predictionId, 'round_of_32', { count: 100 });

    const runId = repo.buildMasterKnockoutView(predictionId).knockoutRuns[0]!.id;
    repo.setPredictionActiveKnockoutSimulation(predictionId, null);
    expect(repo.deleteSimulation(runId)).toBe(true);

    const view = repo.buildMasterKnockoutView(predictionId);
    expect(view.knockoutRuns).toHaveLength(1);
    expect(view.activeKnockoutSimulationId).toBe(view.knockoutRuns[0]!.id);
    const r32 = repo
      .getSimulationMatches(view.knockoutRuns[0]!.id)
      .find((match) => match.matchNumber === 73)!;
    expect(r32.status).toBe('played');
  });

  it('resimulates a single knockout match without changing other matches in the round', () => {
    const sim = repo.createSimulation('Full group');
    const groupFixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of groupFixtures) {
      repo.updateMatchResult(sim.id, f.matchNumber, 1, 0, f.teamHomeId!);
    }

    const predictionId = ensureTestPrediction(repo);
    repo.rebuildAllPredictionAggregates();
    repo.simulatePredictionKnockoutRoundForPrediction(predictionId, 'round_of_32', { count: 100 });

    const before = readPredictionKnockoutResults(repo['db'], predictionId);
    const otherMatch = before.find((result) => result.matchNumber !== 73)!;
    const beforeOther = { ...otherMatch };

    repo.resimulatePredictionKnockoutMatchForPrediction(predictionId, 73, { count: 100 });

    const after = readPredictionKnockoutResults(repo['db'], predictionId);
    const after73 = after.find((result) => result.matchNumber === 73)!;
    const afterOther = after.find((result) => result.matchNumber === otherMatch.matchNumber)!;
    expect(after73.goalsHome).not.toBeNull();
    expect(afterOther.goalsHome).toBe(beforeOther.goalsHome);
    expect(afterOther.goalsAway).toBe(beforeOther.goalsAway);
    expect(repo.buildMasterKnockoutView(predictionId).knockoutRuns).toHaveLength(1);
  });

  it('resimulating a knockout round skips matches with actual results', () => {
    const sim = repo.createSimulation('Full group');
    const groupFixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of groupFixtures) {
      repo.updateMatchResult(sim.id, f.matchNumber, 1, 0, f.teamHomeId!);
    }

    const predictionId = ensureTestPrediction(repo);
    repo.rebuildAllPredictionAggregates();
    repo.simulatePredictionKnockoutRoundForPrediction(predictionId, 'round_of_32', { count: 100 });

    const before = readPredictionKnockoutResults(repo['db'], predictionId);
    const lockedMatch = before.find((result) => result.matchNumber === 73)!;
    repo.setActualResult(73, 3, 1, null);

    repo.simulatePredictionKnockoutRoundForPrediction(predictionId, 'round_of_32', {
      count: 100,
      resimulate: true,
    });

    const after = readPredictionKnockoutResults(repo['db'], predictionId);
    const afterLocked = after.find((result) => result.matchNumber === 73)!;
    expect(afterLocked.goalsHome).toBe(lockedMatch.goalsHome);
    expect(afterLocked.goalsAway).toBe(lockedMatch.goalsAway);
    expect(after.length).toBeGreaterThan(1);
    const changed = after.find(
      (result) =>
        result.matchNumber !== 73 &&
        before.some(
          (entry) =>
            entry.matchNumber === result.matchNumber &&
            (entry.goalsHome !== result.goalsHome || entry.goalsAway !== result.goalsAway),
        ),
    );
    expect(changed).toBeDefined();
  });

  it('master knockout keeps simulated predictions when actual results exist', () => {
    const sim = repo.createSimulation('Full group');
    const groupFixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of groupFixtures) {
      repo.updateMatchResult(sim.id, f.matchNumber, 1, 0, f.teamHomeId!);
    }

    const predictionId = ensureTestPrediction(repo);
    repo.rebuildAllPredictionAggregates();
    repo.simulatePredictionKnockoutRoundForPrediction(predictionId, 'round_of_32', { count: 100 });

    const beforeActual = repo.buildMasterKnockoutView(predictionId);
    const r32Match = beforeActual.resolvedMatches.find((m) => m.fixture.matchNumber === 73)!;
    expect(r32Match.result.status).toBe('played');
    const predictedHome = r32Match.result.goalsHome!;
    const predictedAway = r32Match.result.goalsAway!;

    let actualHome = 2;
    let actualAway = 0;
    if (predictedHome === actualHome && predictedAway === actualAway) {
      actualHome = 3;
      actualAway = 1;
    }
    repo.setActualResult(73, actualHome, actualAway, null);

    const afterActual = repo.buildMasterKnockoutView(predictionId);
    const r32After = afterActual.resolvedMatches.find((m) => m.fixture.matchNumber === 73)!;
    expect(r32After.result.goalsHome).toBe(predictedHome);
    expect(r32After.result.goalsAway).toBe(predictedAway);
    expect(r32After.isLocked).toBe(true);
  });

  it('aggregates team goals across simulations including knockouts', () => {
    const sim1 = repo.createSimulation('One');
    const sim2 = repo.createSimulation('Two');
    const mexicoId = repo.getTeams().find((t) => t.name === 'Mexico')!.id;
    const southAfricaId = repo.getTeams().find((t) => t.name === 'South Africa')!.id;

    repo.updateMatchResult(sim1.id, 1, 2, 1, mexicoId);
    repo.updateMatchResult(sim2.id, 1, 3, 0, mexicoId);

    const predictionId = ensureTestPrediction(repo);
    const groupOnly = repo.buildMasterTeamStats(predictionId);
    const mexicoGroupOnly = groupOnly.teams.find((t) => t.teamId === mexicoId)!;
    expect(mexicoGroupOnly.totalGoals).toBe(5);
    expect(mexicoGroupOnly.simulationsWithMatches).toBe(2);
    expect(mexicoGroupOnly.avgGoalsPerSimulation).toBe(2.5);

    const groupFixtures = repo.getFixtures().filter((f) => f.group);
    for (const f of groupFixtures) {
      if (f.matchNumber === 1) continue;
      repo.updateMatchResult(sim1.id, f.matchNumber, 1, 0, f.teamHomeId);
    }

    const r32 = repo.getSimulationMatches(sim1.id).find((m) => m.matchNumber === 73)!;
    repo.updateMatchResult(sim1.id, 73, 2, 1, r32.teamHomeId);

    const stats = repo.buildMasterTeamStats(predictionId);
    expect(stats.simulationCount).toBe(repo.listSimulations().length);

    const mexico = stats.teams.find((t) => t.teamId === mexicoId)!;
    const southAfrica = stats.teams.find((t) => t.teamId === southAfricaId)!;
    const knockoutHome = stats.teams.find((t) => t.teamId === r32.teamHomeId)!;

    expect(mexico.totalGoals).toBeGreaterThan(mexicoGroupOnly.totalGoals);
    expect(mexico.simulationsWithMatches).toBe(2);
    expect(knockoutHome.totalGoals).toBeGreaterThanOrEqual(2);
    expect(southAfrica.totalGoals).toBeGreaterThanOrEqual(1);
    expect(southAfrica.simulationsWithMatches).toBeGreaterThanOrEqual(1);
  });

  it('counts championship wins from played finals', () => {
    const sim1 = repo.createSimulation('Champ 1');
    const sim2 = repo.createSimulation('Champ 2');
    const mexicoId = repo.getTeams().find((t) => t.name === 'Mexico')!.id;
    const spainId = repo.getTeams().find((t) => t.name === 'Spain')!.id;

    repo.persistMatchResult(sim1.id, 104, 2, 1, mexicoId, { sync: false });
    repo.persistMatchResult(sim2.id, 104, 0, 1, spainId, { sync: false });

    const predictionId = ensureTestPrediction(repo);
    const stats = repo.buildMasterTeamStats(predictionId);
    expect(stats.teams.find((t) => t.teamId === mexicoId)?.championWins).toBe(1);
    expect(stats.teams.find((t) => t.teamId === spainId)?.championWins).toBe(1);
  });

  it('maintains master group match aggregates incrementally', () => {
    const sim1 = repo.createSimulation('One');
    const sim2 = repo.createSimulation('Two');

    repo.updateMatchResult(sim1.id, 1, 2, 1, 18);
    repo.updateMatchResult(sim2.id, 1, 1, 1, null);

    const predictionId = ensureTestPrediction(repo);
    let master = repo.buildMasterGroupView(predictionId);
    expect(master.distributions[1].total).toBe(2);
    expect(master.distributions[1].homeWin).toBe(1);
    expect(master.distributions[1].draw).toBe(1);

    repo.clearMatchResult(sim1.id, 1);
    master = repo.buildMasterGroupView(predictionId);
    expect(master.distributions[1].total).toBe(1);
    expect(master.distributions[1].draw).toBe(1);

    repo.deleteSimulation(sim2.id);
    master = repo.buildMasterGroupView(predictionId);
    expect(master.distributions[1].total).toBe(0);
  });

  it('rebuilds master group match aggregates from simulation data', () => {
    const sim = repo.createSimulation('Rebuild');
    repo.updateMatchResult(sim.id, 1, 3, 0, 18);
    repo.updateMatchResult(sim.id, 2, 0, 2, 19);

    const predictionId = ensureTestPrediction(repo);
    sqlite.exec(`DELETE FROM prediction_match_outcomes WHERE prediction_id = ${predictionId}`);
    sqlite.exec(`DELETE FROM prediction_match_scorelines WHERE prediction_id = ${predictionId}`);
    sqlite.exec(`DELETE FROM prediction_group_match_results WHERE prediction_id = ${predictionId}`);

    repo.rebuildAllPredictionAggregates();
    const master = repo.buildMasterGroupView(predictionId);

    expect(master.distributions[1].total).toBe(1);
    expect(master.distributions[1].homeWin).toBe(1);
    expect(master.distributions[2].total).toBe(1);
    expect(master.distributions[2].awayWin).toBe(1);
  });
});
