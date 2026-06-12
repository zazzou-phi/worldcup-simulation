import type { TournamentState } from '../types.js';
import { KnockoutBracket, KnockoutList } from './KnockoutBracket.js';
import { KnockoutPhaseLayout } from './KnockoutPhaseLayout.js';

interface Props {
  state: TournamentState;
  useBracketView: boolean;
  onViewChange: (useBracket: boolean) => void;
  selectedMatchNumber: number | null;
  editingMatchNumber: number | null;
  simulating?: boolean;
  onSelectMatch: (matchNumber: number | null) => void;
  onStartEdit: (matchNumber: number) => void;
  onSimulateMatch?: (matchNumber: number) => void;
  onSaveScore: (
    matchNumber: number,
    goalsHome: number,
    goalsAway: number,
    winnerTeamId: number | null,
  ) => void;
  onCancelEdit: () => void;
  onClearScore: (matchNumber: number) => void;
}

export function KnockoutView(props: Props) {
  const { state } = props;
  const matchProps = {
    matches: state.resolvedMatches,
    selectedMatchNumber: props.selectedMatchNumber,
    editingMatchNumber: props.editingMatchNumber,
    simulating: props.simulating,
    onSelect: props.onSelectMatch,
    onStartEdit: props.onStartEdit,
    onSimulateMatch: props.onSimulateMatch,
    onSave: props.onSaveScore,
    onCancelEdit: props.onCancelEdit,
    onClear: props.onClearScore,
  };

  return (
    <KnockoutPhaseLayout
      useBracketView={props.useBracketView}
      onViewChange={props.onViewChange}
      bracket={<KnockoutBracket {...matchProps} />}
      fixtures={<KnockoutList {...matchProps} />}
    />
  );
}
