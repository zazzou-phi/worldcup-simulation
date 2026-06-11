import type { TournamentState } from '../types.js';
import { KnockoutBracket, KnockoutList } from './KnockoutBracket.js';

interface Props {
  state: TournamentState;
  useBracketView: boolean;
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
  const { state, useBracketView } = props;

  return (
    <div className="knockout-view">
      {useBracketView ? (
        <KnockoutBracket
          matches={state.resolvedMatches}
          selectedMatchNumber={props.selectedMatchNumber}
          editingMatchNumber={props.editingMatchNumber}
          simulating={props.simulating}
          onSelect={props.onSelectMatch}
          onStartEdit={props.onStartEdit}
          onSimulateMatch={props.onSimulateMatch}
          onSave={props.onSaveScore}
          onCancelEdit={props.onCancelEdit}
          onClear={props.onClearScore}
        />
      ) : (
        <KnockoutList
          matches={state.resolvedMatches}
          selectedMatchNumber={props.selectedMatchNumber}
          editingMatchNumber={props.editingMatchNumber}
          simulating={props.simulating}
          onSelect={props.onSelectMatch}
          onStartEdit={props.onStartEdit}
          onSimulateMatch={props.onSimulateMatch}
          onSave={props.onSaveScore}
          onCancelEdit={props.onCancelEdit}
          onClear={props.onClearScore}
        />
      )}
    </div>
  );
}
