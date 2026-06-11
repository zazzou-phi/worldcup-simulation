import { describe, it, expect } from 'vitest';
import type { Team } from '../src/engine/types.js';
import {
  collectPlayedGroupMatches,
  computeGroupStandings,
  rankThirdPlaceTeams,
  computeAllGroupStandings,
} from '../src/engine/standings.js';

function makeTeam(id: number, name: string, rank: number): Team {
  return {
    id,
    name,
    countryCode: 'XX',
    flag: '🏳',
    rank,
    rating: 1500,
    total: 100,
    goalsFor: 0,
    goalsAgainst: 0,
    offensiveRating: 1,
    defensiveRating: 1,
  };
}

describe('group standings', () => {
  it('ranks by points', () => {
    const teams = new Map([
      [1, makeTeam(1, 'A', 10)],
      [2, makeTeam(2, 'B', 20)],
      [3, makeTeam(3, 'C', 30)],
      [4, makeTeam(4, 'D', 40)],
    ]);
    const rows = computeGroupStandings(
      'A',
      [1, 2, 3, 4],
      teams,
      [
        { homeTeamId: 1, awayTeamId: 2, goalsHome: 2, goalsAway: 0 },
        { homeTeamId: 3, awayTeamId: 4, goalsHome: 1, goalsAway: 1 },
        { homeTeamId: 1, awayTeamId: 3, goalsHome: 0, goalsAway: 0 },
        { homeTeamId: 2, awayTeamId: 4, goalsHome: 3, goalsAway: 1 },
        { homeTeamId: 1, awayTeamId: 4, goalsHome: 1, goalsAway: 0 },
        { homeTeamId: 2, awayTeamId: 3, goalsHome: 2, goalsAway: 2 },
      ],
    );
    expect(rows.rows[0].teamId).toBe(1);
    expect(rows.rows[0].points).toBe(7);
  });

  it('ranks by points regardless of membership order', () => {
    const teams = new Map([
      [1, makeTeam(1, 'Canada', 40)],
      [2, makeTeam(2, 'Bosnia', 20)],
      [3, makeTeam(3, 'Qatar', 60)],
      [4, makeTeam(4, 'Switzerland', 10)],
    ]);
    const rows = computeGroupStandings(
      'B',
      [1, 2, 3, 4],
      teams,
      [
        { homeTeamId: 1, awayTeamId: 2, goalsHome: 0, goalsAway: 2 },
        { homeTeamId: 3, awayTeamId: 4, goalsHome: 1, goalsAway: 1 },
        { homeTeamId: 1, awayTeamId: 3, goalsHome: 1, goalsAway: 1 },
        { homeTeamId: 2, awayTeamId: 4, goalsHome: 2, goalsAway: 0 },
        { homeTeamId: 1, awayTeamId: 4, goalsHome: 1, goalsAway: 0 },
        { homeTeamId: 2, awayTeamId: 3, goalsHome: 1, goalsAway: 1 },
      ],
    );
    expect(rows.rows[0].teamId).toBe(2);
    expect(rows.rows[0].points).toBe(7);
    expect(rows.rows[1].teamId).toBe(1);
    expect(rows.rows[1].points).toBe(4);
  });

  it('breaks tie on fifa ranking', () => {
    const teams = new Map([
      [1, makeTeam(1, 'A', 5)],
      [2, makeTeam(2, 'B', 50)],
      [3, makeTeam(3, 'C', 99)],
      [4, makeTeam(4, 'D', 1)],
    ]);
    const rows = computeGroupStandings(
      'A',
      [1, 2, 3, 4],
      teams,
      [
        { homeTeamId: 1, awayTeamId: 2, goalsHome: 0, goalsAway: 0 },
        { homeTeamId: 3, awayTeamId: 4, goalsHome: 0, goalsAway: 0 },
        { homeTeamId: 1, awayTeamId: 3, goalsHome: 0, goalsAway: 0 },
        { homeTeamId: 2, awayTeamId: 4, goalsHome: 0, goalsAway: 0 },
        { homeTeamId: 1, awayTeamId: 4, goalsHome: 1, goalsAway: 0 },
        { homeTeamId: 2, awayTeamId: 3, goalsHome: 1, goalsAway: 0 },
      ],
    );
    expect(rows.rows[0].teamId).toBe(1);
    expect(rows.rows[1].teamId).toBe(2);
    expect(rows.rows[0].points).toBe(rows.rows[1].points);
    expect(rows.rows[0].team.rank).toBeLessThan(rows.rows[1].team.rank);
  });
});

describe('third place ranking', () => {
  it('picks top 8 thirds by points', () => {
    const teams = new Map<number, Team>();
    for (let g = 0; g < 12; g++) {
      for (let t = 0; t < 4; t++) {
        const id = g * 10 + t;
        teams.set(id, makeTeam(id, `T${id}`, id));
      }
    }
    const memberships = 'ABCDEFGHIJKL'.split('').flatMap((letter, gi) =>
      [0, 1, 2, 3].map((ti) => ({ groupLetter: letter, teamId: gi * 10 + ti })),
    );
    const matches = memberships.flatMap(({ groupLetter, teamId }, _i, arr) => {
      const groupIds = arr.filter((m) => m.groupLetter === groupLetter).map((m) => m.teamId);
      return [
        { homeTeamId: groupIds[0], awayTeamId: groupIds[1], goalsHome: 1, goalsAway: 0 },
        { homeTeamId: groupIds[2], awayTeamId: groupIds[3], goalsHome: 1, goalsAway: 0 },
        { homeTeamId: groupIds[0], awayTeamId: groupIds[2], goalsHome: 1, goalsAway: 0 },
        { homeTeamId: groupIds[1], awayTeamId: groupIds[3], goalsHome: 1, goalsAway: 0 },
        { homeTeamId: groupIds[0], awayTeamId: groupIds[3], goalsHome: 1, goalsAway: 0 },
        { homeTeamId: groupIds[1], awayTeamId: groupIds[2], goalsHome: 0, goalsAway: 0 },
      ];
    });
    const standings = computeAllGroupStandings(memberships, teams, matches);
    const thirds = rankThirdPlaceTeams(standings);
    expect(thirds).toHaveLength(12);
    expect(thirds[0].row.points).toBeGreaterThanOrEqual(thirds[7].row.points);
  });

  it('collectPlayedGroupMatches prefers actual results over simulation', () => {
    const fixtures = [
      {
        matchNumber: 1,
        group: 'A',
        teamHomeId: 1,
        teamAwayId: 2,
      },
      {
        matchNumber: 2,
        group: 'A',
        teamHomeId: 3,
        teamAwayId: 4,
      },
    ];
    const simulationMatches = [
      {
        matchNumber: 1,
        goalsHome: 0,
        goalsAway: 1,
        status: 'played' as const,
      },
      {
        matchNumber: 2,
        goalsHome: 2,
        goalsAway: 2,
        status: 'played' as const,
      },
    ];
    const actualResults = [{ matchNumber: 1, goalsHome: 2, goalsAway: 1 }];

    const played = collectPlayedGroupMatches(fixtures, simulationMatches, actualResults);
    expect(played).toEqual([
      { homeTeamId: 1, awayTeamId: 2, goalsHome: 2, goalsAway: 1 },
      { homeTeamId: 3, awayTeamId: 4, goalsHome: 2, goalsAway: 2 },
    ]);
  });
});
