import { useCallback, useMemo } from 'react';
import { canClearActualResult, canModifyActualResult } from '@shared/engine/phase.js';
import type { ActualResultsState } from '../types.js';
import { KnockoutBracket, KnockoutList } from './KnockoutBracket.js';
import { KnockoutPhaseLayout } from './KnockoutPhaseLayout.js';

interface Props {
  actualState: ActualResultsState;
  useBracketView: boolean;
  onViewChange: (useBracket: boolean) => void;
  selectedMatchNumber: number | null;
  editingMatchNumber: number | null;
  onSelectMatch: (matchNumber: number | null) => void;
  onStartEdit: (matchNumber: number) => void;
  onSaveScore: (
    matchNumber: number,
    goalsHome: number,
    goalsAway: number,
    winnerTeamId: number | null,
  ) => void;
  onCancelEdit: () => void;
  onClearScore: (matchNumber: number) => void;
}

export function ActualResultsKnockoutView({
  actualState,
  useBracketView,
  onViewChange,
  selectedMatchNumber,
  editingMatchNumber,
  onSelectMatch,
  onStartEdit,
  onSaveScore,
  onCancelEdit,
  onClearScore,
}: Props) {
  const fixtures = useMemo(
    () => actualState.resolvedMatches.map((match) => match.fixture),
    [actualState.resolvedMatches],
  );

  const canModifyMatch = useCallback(
    (matchNumber: number) =>
      canModifyActualResult(matchNumber, actualState.actualResults, fixtures),
    [actualState.actualResults, fixtures],
  );

  const canClearMatch = useCallback(
    (matchNumber: number) =>
      canClearActualResult(matchNumber, actualState.actualResults, fixtures),
    [actualState.actualResults, fixtures],
  );

  const matchProps = {
    matches: actualState.resolvedMatches,
    selectedMatchNumber,
    editingMatchNumber,
    editRecordedResults: true,
    selectOnScoreClick: true,
    onSelect: onSelectMatch,
    onStartEdit,
    onSave: onSaveScore,
    onCancelEdit,
    onClear: onClearScore,
    canClearMatch,
    canModifyMatch,
  };

  return (
    <KnockoutPhaseLayout
      useBracketView={useBracketView}
      onViewChange={onViewChange}
      bracket={<KnockoutBracket {...matchProps} />}
      fixtures={<KnockoutList {...matchProps} />}
    />
  );
}
