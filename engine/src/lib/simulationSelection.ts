export interface SelectionSpec {
  type: 'ranges';
  ranges: [number, number][];
}

export type ParseSelectionResult =
  | { ok: true; spec: SelectionSpec }
  | { ok: false; error: string };

function normalizeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

export function parseSelectionInput(input: string): ParseSelectionResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: 'Selection is required' };
  }

  const parts = trimmed.split(',');
  const ranges: [number, number][] = [];

  for (const part of parts) {
    const segment = part.trim();
    if (!segment) {
      return { ok: false, error: 'Empty segment in selection' };
    }

    const dash = segment.indexOf('-');
    if (dash === -1) {
      const id = parseInt(segment, 10);
      if (!Number.isInteger(id) || id < 1) {
        return { ok: false, error: `Invalid simulation id: ${segment}` };
      }
      ranges.push([id, id]);
      continue;
    }

    const startStr = segment.slice(0, dash).trim();
    const endStr = segment.slice(dash + 1).trim();
    if (!startStr || !endStr) {
      return { ok: false, error: `Invalid range: ${segment}` };
    }

    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
      return { ok: false, error: `Invalid range: ${segment}` };
    }
    if (start > end) {
      return { ok: false, error: `Range start must be <= end: ${segment}` };
    }
    ranges.push([start, end]);
  }

  return {
    ok: true,
    spec: { type: 'ranges', ranges: normalizeRanges(ranges) },
  };
}

export function parseSelectionSpecJson(raw: string): SelectionSpec {
  const parsed = JSON.parse(raw) as unknown;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as SelectionSpec).type !== 'ranges' ||
    !Array.isArray((parsed as SelectionSpec).ranges)
  ) {
    throw new Error('Invalid selection spec');
  }
  const ranges = (parsed as SelectionSpec).ranges.map((range) => {
    if (!Array.isArray(range) || range.length !== 2) {
      throw new Error('Invalid selection spec range');
    }
    const start = Number(range[0]);
    const end = Number(range[1]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw new Error('Invalid selection spec range values');
    }
    return [start, end] as [number, number];
  });
  return { type: 'ranges', ranges: normalizeRanges(ranges) };
}

export function serializeSelectionSpec(spec: SelectionSpec): string {
  return JSON.stringify(spec);
}

export function simulationIdInSpec(id: number, spec: SelectionSpec): boolean {
  for (const [start, end] of spec.ranges) {
    if (id >= start && id <= end) return true;
  }
  return false;
}

export function buildSimulationIdSqlFilter(spec: SelectionSpec, column = 'sm.simulation_id'): string {
  if (spec.ranges.length === 0) return '0';
  const clauses = spec.ranges.map(([start, end]) => {
    if (start === end) return `${column} = ${start}`;
    return `${column} BETWEEN ${start} AND ${end}`;
  });
  return clauses.length === 1 ? clauses[0]! : `(${clauses.join(' OR ')})`;
}

export function formatSelectionSpec(spec: SelectionSpec): string {
  return spec.ranges
    .map(([start, end]) => (start === end ? String(start) : `${start}–${end}`))
    .join(', ');
}

export function countIdsInSpec(spec: SelectionSpec): number {
  return spec.ranges.reduce((sum, [start, end]) => sum + (end - start + 1), 0);
}
