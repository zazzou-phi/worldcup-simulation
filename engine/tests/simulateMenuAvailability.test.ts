import { describe, it, expect } from 'vitest';
import {
  getDisabledSimulateMenuKeys,
  isSimulateMenuItemDisabled,
} from '../src/engine/simulateMenuAvailability.js';

const fixtures = [
  { matchNumber: 1, group: 'A', round: 'Matchday 1' },
  { matchNumber: 2, group: 'A', round: 'Matchday 8' },
  { matchNumber: 3, group: 'A', round: 'Matchday 14' },
  { matchNumber: 73, group: null, round: 'Round of 32' },
  { matchNumber: 90, group: null, round: 'Round of 16' },
  { matchNumber: 97, group: null, round: 'Quarter-final' },
] as const;

describe('simulateMenuAvailability', () => {
  it('enables all group rounds on a fresh simulation', () => {
    const matches = fixtures.map((fixture) => ({
      matchNumber: fixture.matchNumber,
      status: 'scheduled' as const,
    }));

    expect(isSimulateMenuItemDisabled({ fixtures, matches }, 'group:1')).toBe(false);
    expect(isSimulateMenuItemDisabled({ fixtures, matches }, 'group:2')).toBe(false);
    expect(isSimulateMenuItemDisabled({ fixtures, matches }, 'group:3')).toBe(false);
  });

  it('disables earlier group rounds once a later group round has results', () => {
    const matches = fixtures.map((fixture) => ({
      matchNumber: fixture.matchNumber,
      status: fixture.matchNumber === 2 ? ('played' as const) : ('scheduled' as const),
    }));

    expect(isSimulateMenuItemDisabled({ fixtures, matches }, 'group:1')).toBe(true);
    expect(isSimulateMenuItemDisabled({ fixtures, matches }, 'group:2')).toBe(false);
    expect(isSimulateMenuItemDisabled({ fixtures, matches }, 'group:3')).toBe(false);
  });

  it('disables all group rounds once knockouts have started', () => {
    const matches = fixtures.map((fixture) => ({
      matchNumber: fixture.matchNumber,
      status: fixture.matchNumber === 73 ? ('played' as const) : ('scheduled' as const),
    }));

    const disabled = getDisabledSimulateMenuKeys({ fixtures, matches });
    expect(disabled.has('group:1')).toBe(true);
    expect(disabled.has('group:2')).toBe(true);
    expect(disabled.has('group:3')).toBe(true);
  });

  it('disables earlier knockout rounds once a later knockout round has results', () => {
    const matches = fixtures.map((fixture) => ({
      matchNumber: fixture.matchNumber,
      status: fixture.matchNumber === 90 ? ('played' as const) : ('scheduled' as const),
    }));

    expect(isSimulateMenuItemDisabled({ fixtures, matches }, 'round_of_32')).toBe(true);
    expect(isSimulateMenuItemDisabled({ fixtures, matches }, 'round_of_16')).toBe(false);
    expect(isSimulateMenuItemDisabled({ fixtures, matches }, 'quarter_final')).toBe(false);
  });
});
