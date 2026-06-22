import { getFixturePrefixParts } from '../lib/fixtureLabel.js';

interface Props {
  round: string;
  date: string;
  time: string;
  locked?: boolean;
  className?: string;
}

export function FixturePrefix({
  round,
  date,
  time,
  locked = false,
  className = 'fixture-prefix',
}: Props) {
  const { matchday, kickoff } = getFixturePrefixParts(round, date, time);
  const rootClass = locked ? `${className} fixture-prefix-locked` : className;

  if (matchday != null) {
    return (
      <span className={rootClass}>
        <span className="fixture-prefix-matchday">{matchday}.</span>{' '}
        <span className="fixture-prefix-kickoff">{kickoff}</span>
      </span>
    );
  }

  return (
    <span className={rootClass}>
      <span className="fixture-prefix-kickoff">{kickoff}</span>
    </span>
  );
}
