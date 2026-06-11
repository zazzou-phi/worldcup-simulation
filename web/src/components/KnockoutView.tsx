import { useState } from 'react';
import type { TournamentState } from '../types.js';
import { KnockoutBracket, KnockoutList } from './KnockoutBracket.js';

interface Props {
  state: TournamentState;
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
  const [useBracketView, setUseBracketView] = useState(true);
  const { state } = props;

  return (
    <div className="knockout-view">
      <div className="knockout-toolbar">
        <button
          type="button"
          className={`btn btn-ghost ${useBracketView ? 'active' : ''}`}
          onClick={() => setUseBracketView(true)}
        >
          Bracket
        </button>
        <button
          type="button"
          className={`btn btn-ghost ${!useBracketView ? 'active' : ''}`}
          onClick={() => setUseBracketView(false)}
        >
          List
        </button>
      </div>
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
