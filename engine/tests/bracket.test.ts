import { describe, it, expect } from 'vitest';
import { buildWinnersLosers, lookupAnnexC } from '../src/engine/bracket.js';
import type { Fixture, SimulationMatch, Team } from '../src/engine/types.js';
import annexData from '../../data/annex-c.json' with { type: 'json' };

function makeTeam(id: number, name: string): Team {
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
    eloOffensiveRating: 1,
    eloDefensiveRating: 1,
    goalOffensiveRating: 1,
    goalDefensiveRating: 1,
    blendOffensiveRating: 1,
    blendDefensiveRating: 1,
  };
}

describe('Annex C', () => {
  it('has 495 combinations', () => {
    expect(annexData.combinations).toHaveLength(495);
  });

  it('looks up combination by qualifying groups', () => {
    const entry = lookupAnnexC('EFGHIJKL');
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe(1);
    expect(entry!.thirdByMatch['79']).toBe('E');
    expect(entry!.thirdByMatch['74']).toBe('F');
    expect(entry!.thirdByMatch['82']).toBe('H');
  });

  it('maps the 2026 group-stage third-place combination to official R32 opponents', () => {
    const entry = lookupAnnexC('BDEFIJKL');
    expect(entry).not.toBeNull();
    expect(entry!.thirdByMatch).toEqual({
      '74': 'D',
      '77': 'F',
      '79': 'E',
      '80': 'K',
      '81': 'B',
      '82': 'I',
      '85': 'J',
      '87': 'L',
    });
  });
});

describe('buildWinnersLosers', () => {
  it('derives the winner from goals when the score is decisive', () => {
    const teamsById = new Map([
      [10, makeTeam(10, 'Germany')],
      [32, makeTeam(32, 'South Korea')],
    ]);
    const fixtures: Fixture[] = [
      {
        matchNumber: 97,
        round: 'Quarter-final',
        date: '',
        time: '',
        venue: '',
        group: null,
        slotHome: 'W89',
        slotAway: 'W90',
        teamHomeId: 10,
        teamAwayId: 32,
      },
    ];
    const matches: SimulationMatch[] = [
      {
        simulationId: 1,
        matchNumber: 97,
        teamHomeId: 10,
        teamAwayId: 32,
        goalsHome: 0,
        goalsAway: 1,
        penGoalsHome: null,
        penGoalsAway: null,
        winnerTeamId: 10,
        status: 'played',
      },
    ];
    const { winnersByMatch } = buildWinnersLosers(fixtures, matches, teamsById, {
      standings: [],
      qualifyingThirdGroups: [],
      annexThirdByMatch: {},
    });
    expect(winnersByMatch.get(97)).toBe(32);
  });

  it('uses winnerTeamId for knockout ties', () => {
    const teamsById = new Map([
      [10, makeTeam(10, 'Germany')],
      [32, makeTeam(32, 'South Korea')],
    ]);
    const fixtures: Fixture[] = [
      {
        matchNumber: 104,
        round: 'Final',
        date: '',
        time: '',
        venue: '',
        group: null,
        slotHome: 'W101',
        slotAway: 'W102',
        teamHomeId: 32,
        teamAwayId: 10,
      },
    ];
    const matches: SimulationMatch[] = [
      {
        simulationId: 1,
        matchNumber: 104,
        teamHomeId: 32,
        teamAwayId: 10,
        goalsHome: 0,
        goalsAway: 0,
        penGoalsHome: null,
        penGoalsAway: null,
        winnerTeamId: 10,
        status: 'played',
      },
    ];
    const { winnersByMatch } = buildWinnersLosers(fixtures, matches, teamsById, {
      standings: [],
      qualifyingThirdGroups: [],
      annexThirdByMatch: {},
    });
    expect(winnersByMatch.get(104)).toBe(10);
  });
});
