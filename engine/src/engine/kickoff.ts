const TIME_RE = /^(\d{2}):(\d{2})\s+UTC([+-]\d+)$/;

/** Parse fixture date + time (e.g. "2026-06-11", "13:00 UTC-6") to UTC Date. */
export function parseKickoff(dateStr: string, timeStr: string): Date {
  const match = TIME_RE.exec(timeStr.trim());
  if (!match) {
    throw new Error(`Unparseable kickoff time: ${timeStr}`);
  }
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const offsetHours = parseInt(match[3], 10);
  const [year, month, day] = dateStr.split('-').map((part) => parseInt(part, 10));
  const utcMs =
    Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0, 0);
  return new Date(utcMs);
}

export function hasKickoffPassed(
  dateStr: string,
  timeStr: string,
  asOf: Date = new Date(),
): boolean {
  return parseKickoff(dateStr, timeStr).getTime() <= asOf.getTime();
}
