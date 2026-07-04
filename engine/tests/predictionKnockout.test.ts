import { describe, expect, it } from 'vitest';
import {
  buildDisplayKnockoutResults,
  buildPredictionKnockoutRatings,
  buildPredictionSlotContext,
  computeKnockoutRoundAvailability,
  defaultThirdPlaceOrder,
  getQualifyingThirdGroupsFromOrder,
  simulatePredictionKnockoutMatch,
} from '../src/engine/predictionKnockout.js';
import type { GroupStandings, Team } from '../src/engine/types.js';
import { testRng } from './testRng.js';

function makeTeam(id: number, name: string, offensive = 1.1): Team {
  return {
    id,
    name,
    countryCode: 'XX',
    flag: '🏳',
    rank: id,
    rating: 1500,
    elo: 1500,
    total: 100,
    goalsFor: 0,
    goalsAgainst: 0,
    eloOffensiveRating: offensive,
    eloDefensiveRating: 1,
    goalOffensiveRating: offensive,
    goalDefensiveRating: 1,
    blendOffensiveRating: offensive,
    blendDefensiveRating: 1,
  };
}

function makeStandings(groupLetter: string, thirdTeamId: number, thirdPoints: number): GroupStandings {
  const baseRow = (teamId: number, position: number, points: number) => ({
    teamId,
    team: makeTeam(teamId, `Team ${teamId}`),
    played: 3,
    won: points === 6 ? 2 : 1,
    drawn: points % 3 === 1 ? 1 : 0,
    lost: 0,
    goalsFor: points + 1,
    goalsAgainst: 1,
    goalDifference: points,
    points,
    position,
  });
  return {
    groupLetter,
    rows: [
      baseRow(teamIdFromGroup(groupLetter, 1), 1, 7),
      baseRow(teamIdFromGroup(groupLetter, 2), 2, 5),
      baseRow(thirdTeamId, 3, thirdPoints),
      baseRow(teamIdFromGroup(groupLetter, 4), 4, 1),
    ],
  };
}

function teamIdFromGroup(groupLetter: string, position: number): number {
  return groupLetter.charCodeAt(0) * 10 + position;
}

describe('predictionKnockout', () => {
  it('buildDisplayKnockoutResults keeps stored consensus for locked matches', () => {
    const consensus = [
      {
        matchNumber: 73,
        goalsHome: 2,
        goalsAway: 1,
        winnerTeamId: 18,
        penGoalsHome: null,
        penGoalsAway: null,
      },
    ];
    const path = [
      {
        matchNumber: 73,
        goalsHome: 0,
        goalsAway: 2,
        winnerTeamId: 78,
        penGoalsHome: null,
        penGoalsAway: null,
      },
      {
        matchNumber: 90,
        goalsHome: 1,
        goalsAway: 0,
        winnerTeamId: 18,
        penGoalsHome: null,
        penGoalsAway: null,
      },
    ];

    const display = buildDisplayKnockoutResults(consensus, path, new Set([73]));
    const r32 = display.find((result) => result.matchNumber === 73)!;
    const r16 = display.find((result) => result.matchNumber === 90)!;

    expect(r32.goalsHome).toBe(2);
    expect(r32.goalsAway).toBe(1);
    expect(r16.goalsHome).toBe(1);
    expect(r16.goalsAway).toBe(0);
  });

  it('derives qualifying third groups from manual order', () => {
    const order = [
      { groupLetter: 'B', position: 1 },
      { groupLetter: 'A', position: 2 },
      { groupLetter: 'C', position: 3 },
      { groupLetter: 'D', position: 4 },
      { groupLetter: 'E', position: 5 },
      { groupLetter: 'F', position: 6 },
      { groupLetter: 'G', position: 7 },
      { groupLetter: 'H', position: 8 },
      { groupLetter: 'I', position: 9 },
    ];
    expect(getQualifyingThirdGroupsFromOrder(order)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });

  it('seeds default third-place order from standings ranking', () => {
    const standings = [
      makeStandings('A', 103, 4),
      makeStandings('B', 203, 6),
    ];
    const order = defaultThirdPlaceOrder(standings);
    expect(order[0]?.groupLetter).toBe('B');
    expect(order[1]?.groupLetter).toBe('A');
  });

  it('uses manual third-place order when building slot context', () => {
    const standings = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((letter, index) =>
      makeStandings(letter, teamIdFromGroup(letter, 3), 6 - Math.floor(index / 2)),
    );
    const manualOrder = defaultThirdPlaceOrder(standings).reverse();
    const teamsById = new Map<number, Team>();
    for (const group of standings) {
      for (const row of group.rows) {
        teamsById.set(row.teamId, row.team);
      }
    }

    const { ctx, annexCCombinationId } = buildPredictionSlotContext(
      standings,
      manualOrder,
      [],
      [],
      teamsById,
    );

    expect(ctx.qualifyingThirdGroups).toEqual(
      getQualifyingThirdGroupsFromOrder(manualOrder),
    );
    expect(annexCCombinationId).not.toBeNull();
  });

  it('gates later rounds until the previous round is complete', () => {
    const standings = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((letter) =>
      makeStandings(letter, teamIdFromGroup(letter, 3), 4),
    );
    const thirdPlaceOrder = defaultThirdPlaceOrder(standings);
    const teamsById = new Map<number, Team>();
    for (const group of standings) {
      for (const row of group.rows) {
        teamsById.set(row.teamId, row.team);
      }
    }
    const { ctx } = buildPredictionSlotContext(standings, thirdPlaceOrder, [], [], teamsById);
    const roundsAfterR32 = computeKnockoutRoundAvailability(
      [],
      ctx,
      teamsById,
      [
        {
          matchNumber: 73,
          goalsHome: 1,
          goalsAway: 0,
          winnerTeamId: 1,
          penGoalsHome: null,
          penGoalsAway: null,
        },
      ],
      true,
    );

    expect(roundsAfterR32[1]?.canSimulate).toBe(false);
    expect(roundsAfterR32[1]?.disabledReason).toMatch(/Round of 32/i);
  });

  it('simulates penalties when consensus scoreline is a draw', () => {
    const home = makeTeam(1, 'Home', 1);
    const away = makeTeam(2, 'Away', 1);

    let sawPenaltyResult = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const result = simulatePredictionKnockoutMatch(home, away, 'rounded', {
        count: 1000,
        upsetVariance: 0,
        rng: testRng(100 + attempt),
      });
      expect(result.distribution.total).toBe(1000);
      expect(result.distribution.scorelines.length).toBeGreaterThan(0);
      if (result.goalsHome === result.goalsAway) {
        expect(result.winnerTeamId).not.toBeNull();
        expect(result.penGoalsHome).not.toBeNull();
        expect(result.penGoalsAway).not.toBeNull();
        sawPenaltyResult = true;
        break;
      }
    }

    expect(sawPenaltyResult).toBe(true);
  });

  it('buildPredictionKnockoutRatings applies tournament form from consensus group results', () => {
    const home = makeTeam(1, 'Home', 1);
    const away = makeTeam(2, 'Away', 1);
    const teams = [home, away];
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const fixture = {
      matchNumber: 1,
      teamHomeId: home.id,
      teamAwayId: away.id,
      group: 'A',
      matchday: 1,
      kickoff: '2026-06-01',
      venue: 'Test',
    };
    const groupResolvedMatches = [
      {
        fixture,
        result: {
          simulationId: 0,
          matchNumber: 1,
          teamHomeId: home.id,
          teamAwayId: away.id,
          goalsHome: 3,
          goalsAway: 0,
          winnerTeamId: home.id,
          status: 'played' as const,
        },
      },
    ];
    const { ctx } = buildPredictionSlotContext([], [], [fixture], [], teamsById);
    const baseline = buildPredictionKnockoutRatings(
      teams,
      [fixture],
      ctx,
      teamsById,
      groupResolvedMatches,
      [],
      1,
      0,
    );
    const withForm = buildPredictionKnockoutRatings(
      teams,
      [fixture],
      ctx,
      teamsById,
      groupResolvedMatches,
      [],
      1,
      2,
    );
    expect(withForm.get(home.id)!.offensiveRating).toBeGreaterThan(
      baseline.get(home.id)!.offensiveRating,
    );
  });
});
