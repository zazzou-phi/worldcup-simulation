import { describe, expect, it } from 'vitest';
import { FINAL_MATCH_NUMBER, THIRD_PLACE_MATCH_NUMBER } from '../src/lib/bracket-layout.js';
import {
  computeBracketRows,
  getMatchAnchor,
  matchNodeWidth,
  WEB_LINEAR_DIMS,
} from '../src/lib/bracket-linear.js';

describe('bracket-linear', () => {
  it('assigns centered rows for each knockout round', () => {
    const rows = computeBracketRows();
    expect(rows.get(73)).toBe(0);
    expect(rows.get(88)).toBe(13);
    expect(rows.get(90)).toBe(0.5);
    expect(rows.get(FINAL_MATCH_NUMBER)).toBe(7.5);
    expect(rows.get(THIRD_PLACE_MATCH_NUMBER)).toBe(7.5);
  });

  it('anchors connector edges to node bounds', () => {
    const rows = computeBracketRows();
    const dims = WEB_LINEAR_DIMS;
    const anchor = getMatchAnchor(91, rows, dims);
    expect(anchor.right - anchor.left).toBe(matchNodeWidth(91, dims));
  });
});
