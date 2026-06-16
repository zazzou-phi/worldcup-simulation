import { parseKickoff } from '@shared/engine/kickoff.js';

function formatKickoffCet(date: string, time: string): string {
  const kickoff = parseKickoff(date, time);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(kickoff);
  const day = parts.find((part) => part.type === 'day')!.value;
  const month = parts.find((part) => part.type === 'month')!.value;
  const hour = parts.find((part) => part.type === 'hour')!.value;
  return `${day}.${month} ${hour}`;
}

export function formatFixturePrefix(round: string, date: string, time: string): string {
  const kickoff = formatKickoffCet(date, time);
  const matchday = /^Matchday (\d+)$/.exec(round)?.[1];
  return matchday != null ? `${matchday}. ${kickoff}` : kickoff;
}
