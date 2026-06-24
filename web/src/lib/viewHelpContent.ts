import type { AppView } from './appView.js';
import { APP_VIEW_LABELS } from './appView.js';
import { CONSENSUS_MODE_HINT } from './consensusMode.js';
import { RATING_ELO_WEIGHT_HINT } from './ratingEloWeight.js';
import { TOURNAMENT_FORM_HINT } from './tournamentEloDeltaWeight.js';
import { UPSET_FACTOR_HINT } from '../components/UpsetFactorControl.js';

export type HelpSection = {
  title?: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type ViewHelp = {
  title: string;
  about: HelpSection[];
  howTo: HelpSection[];
};

function simulationsHelp(publicMode: boolean): ViewHelp {
  const about: HelpSection[] = [
    {
      title: 'What this view shows',
      paragraphs: [
        'Simulations is your personal tournament run. Each match is simulated with a Poisson goals model based on team offensive and defensive ratings.',
      ],
    },
    {
      title: 'Country Ratings blend',
      paragraphs: [RATING_ELO_WEIGHT_HINT],
    },
    {
      title: 'Tournament form',
      paragraphs: [TOURNAMENT_FORM_HINT],
    },
    {
      title: 'Upset factor',
      paragraphs: [UPSET_FACTOR_HINT],
    },
    {
      title: 'Knockout ties',
      paragraphs: [
        'When a knockout match ends level on goals, the winner is chosen with probability proportional to each team\'s expected goals (λ).',
      ],
    },
  ];

  if (publicMode) {
    about.push({
      title: 'Public mode',
      paragraphs: [
        'Your Country Ratings blend and Tournament form settings are saved in this browser. Simulations run entirely on your device.',
      ],
    });
  } else {
    about.push({
      title: 'Private mode',
      paragraphs: [
        'Your Country Ratings blend and Tournament form setting are saved to the database and shared across your simulations.',
      ],
    });
  }

  const howToBullets = [
    'Use the Simulate menu to run group rounds (1–3), advance through knockout rounds, or simulate a single match by clicking its score.',
    'In the ⋮ options menu, adjust Country Ratings, Tournament form, and Upset sliders, open Country Ratings or Tournament Stats, and switch between Group and Knockout stages.',
    'Click an unplayed score to simulate that match; double-click to enter a score manually.',
    'Knockout draws require picking a winner after entering equal goals.',
    'Click a team in the standings to filter the fixture list to that team\'s matches.',
    'On mobile, use the Standings and Fixtures tabs to switch panels.',
    'In Knockout stage, toggle between bracket and list views within the main content area.',
  ];

  if (!publicMode) {
    howToBullets.splice(1, 0, 'Use Bulk in the Simulate menu to run many Monte Carlo simulations at once.');
    howToBullets.push('Use Manage Simulations in the ⋮ menu to create, switch, rename, or delete simulation runs.');
  } else {
    howToBullets.splice(1, 0, 'Use Clear in the Simulate menu to reset your personal simulation.');
  }

  return {
    title: APP_VIEW_LABELS.simulations,
    about,
    howTo: [{ title: 'Controls and interactions', bullets: howToBullets }],
  };
}

function predictionsHelp(publicMode: boolean): ViewHelp {
  const about: HelpSection[] = [
    {
      title: 'What this view shows',
      paragraphs: [
        'Predictions aggregates results from the prediction pool\'s simulations into a consensus group view — standings, fixture scores, and outcome distributions.',
      ],
    },
    {
      title: 'Consensus modes',
      paragraphs: [CONSENSUS_MODE_HINT],
      bullets: [
        'Floor — floored mean goals with modal scores for wins.',
        'Rounded — rounded mean goals only.',
        'Outcome — modal result (win/draw/loss), then modal score within that outcome.',
        'Scoreline — most frequent exact scoreline.',
        'Sample — use the Sample button: switches to saved pool scores, samples on first use, Resample when already active.',
      ],
    },
  ];

  if (!publicMode) {
    about.push({
      title: 'Double-down weighting',
      paragraphs: [
        'Fixtures marked with a double-down icon are weighted more heavily when computing consensus standings. On the Group stage, the counter in the fixture list controls how many group fixtures receive this boost (up to 10). On the Knockout stage, one Round of 32 fixture is marked the same way.',
      ],
    });
  }

  if (publicMode) {
    about.push({
      title: 'Reveal policy',
      paragraphs: [
        'Predictions for fixtures whose kickoff has not yet passed at export time are hidden. Re-export after kickoff to reveal newly available picks.',
      ],
    });
  }

  const howToBullets = [
    'Click a fixture that has simulation data to open its distribution modal — outcome probabilities, top scorelines, and expected goals' +
      (publicMode ? '.' : ', and rating λ.'),
    'Click a team in the standings to filter the fixture list.',
    'In the ⋮ options menu, change the consensus mode, open Tournament Stats or Team Stats.',
    'On mobile, use the Standings and Fixtures tabs to switch panels.',
  ];

  if (!publicMode) {
    howToBullets.splice(
      3,
      0,
      'Use Sample on the Group stage to switch to saved pool scores. If none exist yet, it samples unlocked group fixtures from the pool. Press Sample again while active to Resample (with confirmation).',
      'On the Knockout stage, Resample round in ⋮ re-runs Monte Carlo for the latest simulated knockout round only — group fixtures are not changed.',
      'Save consensus mode changes with Save mode in the ⋮ menu.',
      'Override consensus for individual fixtures in the distribution modal (frozen consensus).',
      'Adjust the double-down counter in the Group fixture list to highlight influential group fixtures.',
      'On the Knockout stage, one Round of 32 fixture is auto-marked as double-down; fix it on played actual results if needed.',
      'Use Manage Predictions in the ⋮ menu to create, switch, rename, or delete prediction sets.',
    );
  }

  return {
    title: APP_VIEW_LABELS.predictions,
    about,
    howTo: [{ title: 'Controls and interactions', bullets: howToBullets }],
  };
}

function resultsHelp(): ViewHelp {
  return {
    title: APP_VIEW_LABELS.results,
    about: [
      {
        title: 'What this view shows',
        paragraphs: [
          'Results is the source of truth for real match scores entered so far.',
        ],
      },
      {
        title: 'How results affect other views',
        paragraphs: [
          'Actual scores feed into Predictions standings and lock the corresponding fixtures in Simulations — simulated scores cannot override a recorded result.',
        ],
      },
    ],
    howTo: [
      {
        title: 'Controls and interactions',
        bullets: [
          'Use Group / Knockout in the ⋮ menu to switch between group tables and the knockout bracket.',
          'Double-click a score to edit it; clear scores where allowed.',
          'Knockout draws require picking a winner after entering equal goals.',
          'On mobile, use the Standings and Fixtures tabs (group) or Bracket and Fixtures tabs (knockout).',
        ],
      },
    ],
  };
}

export function getViewHelp(view: AppView, publicMode: boolean): ViewHelp {
  switch (view) {
    case 'simulations':
      return simulationsHelp(publicMode);
    case 'predictions':
      return predictionsHelp(publicMode);
    case 'results':
      return resultsHelp();
  }
}
