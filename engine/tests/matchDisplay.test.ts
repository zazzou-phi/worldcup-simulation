import { describe, it, expect } from 'vitest';
import { formatMatchScore } from '../src/lib/matchDisplay.js';

describe('formatMatchScore', () => {
  it('shows regulation and penalty scores for shootouts', () => {
    expect(
      formatMatchScore(1, 1, true, { penGoalsHome: 4, penGoalsAway: 3 }),
    ).toBe('1 - 1 (4-3)');
  });

  it('falls back to (p) markers when only the winner is known', () => {
    expect(formatMatchScore(0, 0, true, { penWinnerSide: 'home' })).toBe('(p) 0 - 0');
    expect(formatMatchScore(2, 2, true, { penWinnerSide: 'away' })).toBe('2 - 2 (p)');
  });
});
