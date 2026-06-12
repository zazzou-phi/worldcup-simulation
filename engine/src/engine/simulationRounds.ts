/** Knockout rounds for auto-simulation (third place and final share the post-semi tier). */
export const SIMULATION_KNOCKOUT_ROUNDS: ReadonlyArray<{
  name: string;
  matches: readonly number[];
}> = [
  {
    name: 'round_of_32',
    matches: [73, 75, 74, 77, 83, 84, 81, 82, 76, 78, 79, 80, 86, 88, 85, 87],
  },
  { name: 'round_of_16', matches: [90, 89, 91, 92, 93, 94, 95, 96] },
  { name: 'quarter_final', matches: [97, 99, 98, 100] },
  { name: 'semi_final', matches: [101, 102] },
  { name: 'third_place', matches: [103] },
  { name: 'final', matches: [104] },
];

export const THIRD_PLACE_MATCH_NUMBER = 103;
export const FINAL_MATCH_NUMBER = 104;
export const FINALS_MATCH_NUMBERS = [THIRD_PLACE_MATCH_NUMBER, FINAL_MATCH_NUMBER] as const;

export function isFinalsRoundName(roundName: string): boolean {
  return roundName === 'third_place' || roundName === 'final';
}

/** Menu/cascade tier index; third place and final share the post-semi tier. */
export function knockoutRoundTierIndex(roundName: string): number {
  if (roundName === 'final') {
    return SIMULATION_KNOCKOUT_ROUNDS.findIndex((round) => round.name === 'third_place');
  }
  return SIMULATION_KNOCKOUT_ROUNDS.findIndex((round) => round.name === roundName);
}
