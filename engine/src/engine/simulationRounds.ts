/** Knockout rounds for auto-simulation (third place after semis, before final). */
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

export const FINAL_MATCH_NUMBER = 104;
