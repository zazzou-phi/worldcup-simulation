import { describe, expect, it } from 'vitest';
import {
  areThirdPlaceTeamsTiedOnStats,
  compareThirdPlaceStats,
  isValidThirdPlaceOrder,
  validateThirdPlaceOrder,
} from '../src/engine/thirdPlaceOrder.js';
import type { GroupStandings } from '../src/engine/types.js';

function makeThirdPlaceStandings(
  groupLetter: string,
  points: number,
  goalDifference: number,
  goalsFor: number,
): GroupStandings {
  return {
    groupLetter,
    rows: [
      {
        teamId: 1,
        team: { id: 1, name: 'A', countryCode: null, flag: '🏳', rank: 1 } as GroupStandings['rows'][0]['team'],
        played: 3,
        won: 2,
        drawn: 0,
        lost: 1,
        goalsFor: 4,
        goalsAgainst: 2,
        goalDifference: 2,
        points: 6,
        position: 1,
      },
      {
        teamId: 2,
        team: { id: 2, name: 'B', countryCode: null, flag: '🏳', rank: 2 } as GroupStandings['rows'][0]['team'],
        played: 3,
        won: 1,
        drawn: 1,
        lost: 1,
        goalsFor: 3,
        goalsAgainst: 3,
        goalDifference: 0,
        points: 4,
        position: 2,
      },
      {
        teamId: 3,
        team: { id: 3, name: 'C', countryCode: null, flag: '🏳', rank: 3 } as GroupStandings['rows'][0]['team'],
        played: 3,
        won: 1,
        drawn: 0,
        lost: 2,
        goalsFor,
        goalsAgainst: goalsFor - goalDifference,
        goalDifference,
        points,
        position: 3,
      },
      {
        teamId: 4,
        team: { id: 4, name: 'D', countryCode: null, flag: '🏳', rank: 4 } as GroupStandings['rows'][0]['team'],
        played: 3,
        won: 0,
        drawn: 0,
        lost: 3,
        goalsFor: 1,
        goalsAgainst: 5,
        goalDifference: -4,
        points: 0,
        position: 4,
      },
    ],
  };
}

describe('thirdPlaceOrder', () => {
  it('detects tied teams on pts, GD, and GF', () => {
    const a = { points: 4, goalDifference: 0, goalsFor: 3 };
    const b = { points: 4, goalDifference: 0, goalsFor: 3 };
    const c = { points: 4, goalDifference: 0, goalsFor: 4 };

    expect(areThirdPlaceTeamsTiedOnStats(a, b)).toBe(true);
    expect(areThirdPlaceTeamsTiedOnStats(a, c)).toBe(false);
    expect(compareThirdPlaceStats(c, a)).toBeLessThan(0);
  });

  it('accepts swapped order within tied teams', () => {
    const standings = [
      makeThirdPlaceStandings('A', 4, 0, 3),
      makeThirdPlaceStandings('B', 4, 0, 3),
      makeThirdPlaceStandings('C', 3, 1, 4),
    ];
    const order = [
      { groupLetter: 'B', position: 1 },
      { groupLetter: 'A', position: 2 },
      { groupLetter: 'C', position: 3 },
    ];

    expect(isValidThirdPlaceOrder(order, standings)).toBe(true);
    expect(() => validateThirdPlaceOrder(order, standings)).not.toThrow();
  });

  it('rejects order that inverts teams with different points', () => {
    const standings = [
      makeThirdPlaceStandings('A', 4, 0, 3),
      makeThirdPlaceStandings('B', 3, 0, 2),
    ];
    const order = [
      { groupLetter: 'B', position: 1 },
      { groupLetter: 'A', position: 2 },
    ];

    expect(isValidThirdPlaceOrder(order, standings)).toBe(false);
    expect(() => validateThirdPlaceOrder(order, standings)).toThrow(/cannot rank above/);
  });
});
