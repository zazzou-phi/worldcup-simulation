import { describe, expect, it } from 'vitest';
import { compareFixturesChronologically } from '../src/engine/fixtureOrder.js';
import type { Fixture } from '../src/engine/types.js';

function fixture(overrides: Partial<Fixture> & Pick<Fixture, 'matchNumber'>): Fixture {
  return {
    round: 'Matchday 1',
    date: '2026-06-11',
    time: '13:00 UTC-6',
    venue: '',
    group: 'Group A',
    slotHome: '',
    slotAway: '',
    teamHomeId: null,
    teamAwayId: null,
    ...overrides,
  };
}

describe('compareFixturesChronologically', () => {
  it('orders by matchday before match number', () => {
    const earlierMd = fixture({ matchNumber: 19, round: 'Matchday 2', date: '2026-06-12' });
    const laterMd = fixture({ matchNumber: 3, round: 'Matchday 8', date: '2026-06-18' });
    expect(compareFixturesChronologically(earlierMd, laterMd)).toBeLessThan(0);
  });

  it('orders same matchday by kickoff time', () => {
    const early = fixture({
      matchNumber: 7,
      round: 'Matchday 2',
      date: '2026-06-12',
      time: '15:00 UTC-4',
    });
    const late = fixture({
      matchNumber: 19,
      round: 'Matchday 2',
      date: '2026-06-12',
      time: '18:00 UTC-7',
    });
    expect(compareFixturesChronologically(early, late)).toBeLessThan(0);
  });
});
