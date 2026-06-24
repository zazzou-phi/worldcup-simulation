import { describe, expect, it } from 'vitest';
import {
  parsePredictionKnockoutCount,
  parseResimulateFlag,
} from '../src/api/predictionKnockout.js';
import { knockoutMatchNumbersFromRoundOnward } from '../src/engine/predictionKnockout.js';

describe('predictionKnockout API parsers', () => {
  it('parsePredictionKnockoutCount coerces numeric strings', () => {
    expect(parsePredictionKnockoutCount('5000')).toBe(5000);
  });

  it('parsePredictionKnockoutCount allows single simulation', () => {
    expect(parsePredictionKnockoutCount(1)).toBe(1);
  });

  it('parseResimulateFlag only accepts true', () => {
    expect(parseResimulateFlag(true)).toBe(true);
    expect(parseResimulateFlag(false)).toBe(false);
    expect(parseResimulateFlag('true')).toBe(false);
  });
});

describe('knockoutMatchNumbersFromRoundOnward', () => {
  it('includes later round matches when clearing from R32', () => {
    const matches = knockoutMatchNumbersFromRoundOnward('round_of_32');
    expect(matches).toContain(73);
    expect(matches).toContain(104);
  });
});
