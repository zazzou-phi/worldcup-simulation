import { describe, it, expect, afterEach } from 'vitest';
import {
  chooseConsensus,
  chooseExpectedGoalsScoreline,
  chooseModalScoreline,
  chooseOutcome,
  chooseRepresentativeScoreline,
  chooseScoreline,
  computeFlooredExpectedGoals,
  computeRoundedExpectedGoals,
  getConsensusMode,
} from '../src/engine/consensus.js';

describe('chooseOutcome', () => {
  it('picks the highest count', () => {
    expect(chooseOutcome({ homeWin: 5, draw: 3, awayWin: 2 }, 1, 1)).toBe('homeWin');
  });

  it('prefers a win over a draw on tie', () => {
    expect(chooseOutcome({ homeWin: 5, draw: 5, awayWin: 2 }, 1, 1)).toBe('homeWin');
    expect(chooseOutcome({ homeWin: 2, draw: 5, awayWin: 5 }, 1, 2)).toBe('awayWin');
  });

  it('breaks home/away win ties by offensive rating', () => {
    expect(chooseOutcome({ homeWin: 5, draw: 2, awayWin: 5 }, 1.5, 1.0)).toBe('homeWin');
    expect(chooseOutcome({ homeWin: 5, draw: 2, awayWin: 5 }, 1.0, 1.5)).toBe('awayWin');
  });

  it('returns null when no simulations', () => {
    expect(chooseOutcome({ homeWin: 0, draw: 0, awayWin: 0 }, 1, 1)).toBeNull();
  });
});

describe('chooseScoreline', () => {
  const scorelines = [
    { goalsHome: 2, goalsAway: 0, n: 2 },
    { goalsHome: 2, goalsAway: 1, n: 1 },
    { goalsHome: 3, goalsAway: 0, n: 1 },
    { goalsHome: 1, goalsAway: 1, n: 4 },
  ];

  it('picks the most frequent scoreline for the outcome', () => {
    expect(chooseScoreline(scorelines, 'homeWin')).toEqual({ goalsHome: 2, goalsAway: 0 });
    expect(chooseScoreline(scorelines, 'draw')).toEqual({ goalsHome: 1, goalsAway: 1 });
  });

  it('breaks scoreline ties by total goals', () => {
    const tied = [
      { goalsHome: 1, goalsAway: 0, n: 2 },
      { goalsHome: 2, goalsAway: 0, n: 2 },
    ];
    expect(chooseScoreline(tied, 'homeWin')).toEqual({ goalsHome: 2, goalsAway: 0 });
  });

  it('returns null when no matching scorelines', () => {
    expect(chooseScoreline([], 'draw')).toBeNull();
  });
});

describe('chooseModalScoreline', () => {
  it('picks the most frequent scoreline regardless of outcome', () => {
    const scorelines = [
      { goalsHome: 2, goalsAway: 0, n: 10 },
      { goalsHome: 1, goalsAway: 1, n: 5 },
      { goalsHome: 0, goalsAway: 1, n: 2 },
    ];
    expect(chooseModalScoreline(scorelines)).toEqual({ goalsHome: 2, goalsAway: 0 });
  });

  it('returns null when no scorelines', () => {
    expect(chooseModalScoreline([])).toBeNull();
  });
});

describe('chooseRepresentativeScoreline', () => {
  it('compares the modal scoreline within each outcome', () => {
    const scorelines = [
      { goalsHome: 2, goalsAway: 0, n: 3 },
      { goalsHome: 1, goalsAway: 0, n: 2 },
      { goalsHome: 1, goalsAway: 1, n: 5 },
      { goalsHome: 0, goalsAway: 1, n: 2 },
    ];
    expect(chooseRepresentativeScoreline(scorelines, 1, 1)).toEqual({
      goalsHome: 1,
      goalsAway: 1,
    });
  });

  it('prefers a draw when representatives tie on count', () => {
    const scorelines = [
      { goalsHome: 1, goalsAway: 0, n: 4 },
      { goalsHome: 1, goalsAway: 1, n: 4 },
      { goalsHome: 0, goalsAway: 1, n: 2 },
    ];
    expect(chooseRepresentativeScoreline(scorelines, 1, 1)).toEqual({
      goalsHome: 1,
      goalsAway: 1,
    });
  });
});

describe('computeFlooredExpectedGoals', () => {
  it('floors mean goals across scoreline counts', () => {
    const scorelines = [
      { goalsHome: 2, goalsAway: 0, n: 3 },
      { goalsHome: 0, goalsAway: 0, n: 1 },
    ];
    expect(computeFlooredExpectedGoals(scorelines)).toEqual({ goalsHome: 1, goalsAway: 0 });
  });

  it('returns null when no scorelines', () => {
    expect(computeFlooredExpectedGoals([])).toBeNull();
  });
});

describe('computeRoundedExpectedGoals', () => {
  it('rounds mean goals across scoreline counts', () => {
    const scorelines = [
      { goalsHome: 2, goalsAway: 0, n: 3 },
      { goalsHome: 0, goalsAway: 0, n: 1 },
    ];
    expect(computeRoundedExpectedGoals(scorelines)).toEqual({ goalsHome: 2, goalsAway: 0 });
  });

  it('rounds fractional means without modal scoreline adjustment', () => {
    const scorelines = [
      { goalsHome: 1, goalsAway: 0, n: 4 },
      { goalsHome: 3, goalsAway: 0, n: 4 },
    ];
    expect(computeRoundedExpectedGoals(scorelines)).toEqual({ goalsHome: 2, goalsAway: 0 });
    expect(chooseExpectedGoalsScoreline(scorelines)).toEqual({ goalsHome: 3, goalsAway: 0 });
  });

  it('returns null when no scorelines', () => {
    expect(computeRoundedExpectedGoals([])).toBeNull();
  });
});

describe('chooseExpectedGoalsScoreline', () => {
  it('uses floored scoreline for draws', () => {
    const scorelines = [
      { goalsHome: 1, goalsAway: 1, n: 6 },
      { goalsHome: 2, goalsAway: 2, n: 4 },
    ];
    expect(chooseExpectedGoalsScoreline(scorelines)).toEqual({ goalsHome: 1, goalsAway: 1 });
  });

  it('uses modal scoreline within outcome for wins', () => {
    const scorelines = [
      { goalsHome: 2, goalsAway: 0, n: 10 },
      { goalsHome: 3, goalsAway: 0, n: 2 },
      { goalsHome: 4, goalsAway: 0, n: 1 },
    ];
    expect(chooseExpectedGoalsScoreline(scorelines)).toEqual({ goalsHome: 2, goalsAway: 0 });
  });

  it('returns null when no scorelines', () => {
    expect(chooseExpectedGoalsScoreline([])).toBeNull();
  });
});

describe('chooseConsensus', () => {
  const scorelines = [
    { goalsHome: 2, goalsAway: 0, n: 3 },
    { goalsHome: 1, goalsAway: 1, n: 5 },
    { goalsHome: 0, goalsAway: 1, n: 2 },
  ];
  const outcomeCounts = { homeWin: 5, draw: 5, awayWin: 2 };

  it('uses modal scoreline in scoreline mode', () => {
    expect(
      chooseConsensus({
        mode: 'scoreline',
        outcomeCounts,
        scorelines,
        homeOffensive: 1,
        awayOffensive: 1,
      }),
    ).toEqual({ goalsHome: 1, goalsAway: 1 });
  });

  it('uses outcome then scoreline in outcome mode', () => {
    expect(
      chooseConsensus({
        mode: 'outcome',
        outcomeCounts,
        scorelines,
        homeOffensive: 1,
        awayOffensive: 1,
      }),
    ).toEqual({ goalsHome: 2, goalsAway: 0 });
  });

  it('uses expected goals with modal scoreline for wins in expected mode', () => {
    expect(
      chooseConsensus({
        mode: 'expected',
        outcomeCounts,
        scorelines: [
          { goalsHome: 1, goalsAway: 1, n: 4 },
          { goalsHome: 2, goalsAway: 0, n: 4 },
        ],
        homeOffensive: 1,
        awayOffensive: 1,
      }),
    ).toEqual({ goalsHome: 2, goalsAway: 0 });
  });

  it('uses rounded mean goals in rounded mode', () => {
    expect(
      chooseConsensus({
        mode: 'rounded',
        outcomeCounts,
        scorelines: [
          { goalsHome: 2, goalsAway: 0, n: 3 },
          { goalsHome: 0, goalsAway: 1, n: 3 },
        ],
        homeOffensive: 1,
        awayOffensive: 1,
      }),
    ).toEqual({ goalsHome: 1, goalsAway: 1 });
  });
});

describe('getConsensusMode', () => {
  const original = process.env.CONSENSUS_MODE;

  afterEach(() => {
    if (original === undefined) delete process.env.CONSENSUS_MODE;
    else process.env.CONSENSUS_MODE = original;
  });

  it('defaults to expected', () => {
    delete process.env.CONSENSUS_MODE;
    expect(getConsensusMode()).toBe('expected');
  });

  it('reads outcome from env', () => {
    process.env.CONSENSUS_MODE = 'outcome';
    expect(getConsensusMode()).toBe('outcome');
  });

  it('reads expected from env', () => {
    process.env.CONSENSUS_MODE = 'expected';
    expect(getConsensusMode()).toBe('expected');
  });
});
