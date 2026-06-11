import type { Fixture } from './types.js';

export function parseMatchday(round: string): number | null {
  const m = round.match(/^Matchday (\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/** Group stage: matchday, then date/time. Knockout: date/time. Tie-break: match number. */
export function compareFixturesChronologically(a: Fixture, b: Fixture): number {
  const mdA = parseMatchday(a.round);
  const mdB = parseMatchday(b.round);
  if (mdA != null && mdB != null) {
    if (mdA !== mdB) return mdA - mdB;
  } else if (mdA != null) return -1;
  else if (mdB != null) return 1;

  const dateCmp = a.date.localeCompare(b.date);
  if (dateCmp !== 0) return dateCmp;

  const timeCmp = a.time.localeCompare(b.time);
  if (timeCmp !== 0) return timeCmp;

  return a.matchNumber - b.matchNumber;
}
