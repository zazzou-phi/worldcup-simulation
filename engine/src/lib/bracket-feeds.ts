export type BracketFeedKind = 'winner' | 'loser';

export interface BracketFeed {
  from: number;
  to: number;
  kind: BracketFeedKind;
}

/** Winner/loser progression between knockout matches (from fixture slots). */
export const BRACKET_FEEDS: BracketFeed[] = [
  { from: 73, to: 90, kind: 'winner' },
  { from: 75, to: 90, kind: 'winner' },
  { from: 76, to: 91, kind: 'winner' },
  { from: 78, to: 91, kind: 'winner' },
  { from: 79, to: 92, kind: 'winner' },
  { from: 80, to: 92, kind: 'winner' },
  { from: 83, to: 93, kind: 'winner' },
  { from: 84, to: 93, kind: 'winner' },
  { from: 81, to: 94, kind: 'winner' },
  { from: 82, to: 94, kind: 'winner' },
  { from: 86, to: 95, kind: 'winner' },
  { from: 88, to: 95, kind: 'winner' },
  { from: 85, to: 96, kind: 'winner' },
  { from: 87, to: 96, kind: 'winner' },
  { from: 74, to: 89, kind: 'winner' },
  { from: 77, to: 89, kind: 'winner' },
  { from: 89, to: 97, kind: 'winner' },
  { from: 90, to: 97, kind: 'winner' },
  { from: 91, to: 99, kind: 'winner' },
  { from: 92, to: 99, kind: 'winner' },
  { from: 93, to: 98, kind: 'winner' },
  { from: 94, to: 98, kind: 'winner' },
  { from: 95, to: 100, kind: 'winner' },
  { from: 96, to: 100, kind: 'winner' },
  { from: 97, to: 101, kind: 'winner' },
  { from: 98, to: 101, kind: 'winner' },
  { from: 99, to: 102, kind: 'winner' },
  { from: 100, to: 102, kind: 'winner' },
  { from: 101, to: 104, kind: 'winner' },
  { from: 102, to: 104, kind: 'winner' },
  { from: 101, to: 103, kind: 'loser' },
  { from: 102, to: 103, kind: 'loser' },
];
