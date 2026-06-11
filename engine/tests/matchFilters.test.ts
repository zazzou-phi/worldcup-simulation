import { describe, expect, it } from 'vitest';
import { filterGroupMatchesByTeam } from '../src/engine/matchFilters.js';
import type { Fixture, ResolvedMatch, SimulationMatch, Team } from '../src/engine/types.js';

function team(id: number, name: string): Team {
  return {
    id,
    name,
    countryCode: null,
    flag: '',
    rank: 1,
    rating: 1500,
    offensiveRating: 1500,
    defensiveRating: 1500,
  };
}

function match(
  matchNumber: number,
  homeId: number,
  awayId: number,
  round = 'Matchday 1',
): ResolvedMatch {
  const fixture: Fixture = {
    matchNumber,
    round,
    date: '2026-06-11',
    time: '15:00',
    venue: 'Test',
    group: 'Group A',
    slotHome: '',
    slotAway: '',
    teamHomeId: homeId,
    teamAwayId: awayId,
  };
  const result: SimulationMatch = {
    simulationId: 0,
    matchNumber,
    goalsHome: null,
    goalsAway: null,
    winnerTeamId: null,
    status: 'scheduled',
    teamHomeId: homeId,
    teamAwayId: awayId,
  };
  return {
    fixture,
    result,
    homeTeam: team(homeId, `Team ${homeId}`),
    awayTeam: team(awayId, `Team ${awayId}`),
    homeLabel: `Team ${homeId}`,
    awayLabel: `Team ${awayId}`,
    isLocked: false,
  };
}

describe('filterGroupMatchesByTeam', () => {
  const matches = [match(1, 1, 2), match(2, 3, 4), match(3, 1, 3, 'Matchday 2')];

  it('returns all matches when teamId is null', () => {
    expect(filterGroupMatchesByTeam(matches, null)).toHaveLength(3);
  });

  it('filters to matches involving the selected team', () => {
    const filtered = filterGroupMatchesByTeam(matches, 1);
    expect(filtered.map((m) => m.fixture.matchNumber)).toEqual([1, 3]);
  });

  it('returns empty when team has no matches', () => {
    expect(filterGroupMatchesByTeam(matches, 99)).toHaveLength(0);
  });
});
