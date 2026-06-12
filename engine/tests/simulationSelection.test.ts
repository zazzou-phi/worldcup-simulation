import { describe, it, expect } from 'vitest';
import {
  buildSimulationIdSqlFilter,
  countIdsInSpec,
  formatSelectionSpec,
  parseSelectionInput,
  parseSelectionSpecJson,
  serializeSelectionSpec,
  simulationIdInSpec,
} from '../src/lib/simulationSelection.js';

describe('simulationSelection', () => {
  it('parses single ids and ranges', () => {
    const result = parseSelectionInput('1-100,105,200-300');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec).toEqual({
      type: 'ranges',
      ranges: [
        [1, 100],
        [105, 105],
        [200, 300],
      ],
    });
  });

  it('merges overlapping and adjacent ranges', () => {
    const result = parseSelectionInput('1-5,5-10,12');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.ranges).toEqual([
      [1, 10],
      [12, 12],
    ]);
  });

  it('rejects empty and malformed input', () => {
    expect(parseSelectionInput('').ok).toBe(false);
    expect(parseSelectionInput('abc').ok).toBe(false);
    expect(parseSelectionInput('5-').ok).toBe(false);
    expect(parseSelectionInput('10-5').ok).toBe(false);
    expect(parseSelectionInput('0').ok).toBe(false);
  });

  it('checks membership by simulation id', () => {
    const result = parseSelectionInput('1-3,5');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(simulationIdInSpec(2, result.spec)).toBe(true);
    expect(simulationIdInSpec(4, result.spec)).toBe(false);
    expect(simulationIdInSpec(5, result.spec)).toBe(true);
  });

  it('builds SQL filter fragments', () => {
    const result = parseSelectionInput('1-3,5');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildSimulationIdSqlFilter(result.spec)).toBe(
      '(sm.simulation_id BETWEEN 1 AND 3 OR sm.simulation_id = 5)',
    );
  });

  it('formats specs for display', () => {
    const result = parseSelectionInput('1-100,105');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatSelectionSpec(result.spec)).toBe('1–100, 105');
  });

  it('counts ids covered by ranges', () => {
    const result = parseSelectionInput('1-3,5');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(countIdsInSpec(result.spec)).toBe(4);
  });

  it('round-trips JSON serialization', () => {
    const result = parseSelectionInput('10-20');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = serializeSelectionSpec(result.spec);
    expect(parseSelectionSpecJson(json)).toEqual(result.spec);
  });
});
