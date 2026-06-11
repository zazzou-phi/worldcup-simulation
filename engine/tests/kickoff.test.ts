import { describe, it, expect } from 'vitest';
import { parseKickoff, hasKickoffPassed } from '../src/engine/kickoff.js';

describe('parseKickoff', () => {
  it('parses UTC-6 kickoff to UTC', () => {
    const kickoff = parseKickoff('2026-06-11', '13:00 UTC-6');
    expect(kickoff.toISOString()).toBe('2026-06-11T19:00:00.000Z');
  });

  it('parses UTC-4 kickoff to UTC', () => {
    const kickoff = parseKickoff('2026-06-12', '15:00 UTC-4');
    expect(kickoff.toISOString()).toBe('2026-06-12T19:00:00.000Z');
  });

  it('throws on invalid time format', () => {
    expect(() => parseKickoff('2026-06-11', '13:00')).toThrow(/Unparseable/);
  });
});

describe('hasKickoffPassed', () => {
  it('returns true when export time is after kickoff', () => {
    const kickoff = parseKickoff('2026-06-11', '13:00 UTC-6');
    expect(hasKickoffPassed('2026-06-11', '13:00 UTC-6', new Date(kickoff.getTime() + 1000))).toBe(
      true,
    );
  });

  it('returns false when export time is before kickoff', () => {
    const kickoff = parseKickoff('2026-06-11', '13:00 UTC-6');
    expect(hasKickoffPassed('2026-06-11', '13:00 UTC-6', new Date(kickoff.getTime() - 1000))).toBe(
      false,
    );
  });
});
