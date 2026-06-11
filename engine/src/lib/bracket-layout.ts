/** Knockout rounds left-to-right: R32 → R16 → QF → SF (+ 3rd place) → Final.
 *  Within each column, feeder pairs for the next round are adjacent. */
export const KNOCKOUT_ROUNDS = [
  {
    name: 'Round of 32',
    matches: [73, 75, 74, 77, 83, 84, 81, 82, 76, 78, 79, 80, 86, 88, 85, 87],
  },
  { name: 'Round of 16', matches: [90, 89, 91, 92, 93, 94, 95, 96] },
  { name: 'Quarter-final', matches: [97, 99, 98, 100] },
  { name: 'Semi-final', matches: [101, 102, 103] },
  { name: 'Final', matches: [104] },
];

export const FINAL_MATCH_NUMBER = 104;
export const THIRD_PLACE_MATCH_NUMBER = 103;

export function allKnockoutMatchNumbers(): number[] {
  return KNOCKOUT_ROUNDS.flatMap((r) => r.matches);
}

export function roundIndexForMatch(matchNumber: number): number {
  const idx = KNOCKOUT_ROUNDS.findIndex((r) => r.matches.includes(matchNumber));
  if (idx < 0) throw new Error(`Unknown knockout match: ${matchNumber}`);
  return idx;
}
