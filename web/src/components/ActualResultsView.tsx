import { useCallback, useEffect, useMemo, useState } from 'react';
import { canClearActualResult, canModifyActualResult } from '@shared/engine/phase.js';
import { filterGroupMatchesByTeam } from '@shared/engine/matchFilters.js';
import { teamCode } from '@shared/lib/teamCodes.js';
import type { ActualResultsState } from '../types.js';
import { GroupTables } from './GroupTables.js';
import { FixtureList } from './FixtureList.js';
import { GroupPhaseLayout } from './GroupPhaseLayout.js';
import { ThirdPlaceEditor } from './ThirdPlaceEditor.js';

interface Props {
  actualState: ActualResultsState;
  selectedMatchNumber: number | null;
  editingMatchNumber: number | null;
  readOnly?: boolean;
  canEditThirdPlace?: boolean;
  onMoveThirdPlaceUp?: (groupLetter: string) => void;
  onMoveThirdPlaceDown?: (groupLetter: string) => void;
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

export function ActualResultsView({
  actualState,
  selectedMatchNumber,
  editingMatchNumber,
  readOnly = false,
  canEditThirdPlace = false,
  onMoveThirdPlaceUp,
  onMoveThirdPlaceDown,
  onSelectMatch,
  onStartEdit,
  onSaveScore,
  onCancelEdit,
  onClearScore,
}: Props) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  useEffect(() => {
    setSelectedTeamId(null);
  }, [actualState.actualResults.length]);

  const allGroupMatches = useMemo(
    () => actualState.resolvedMatches.filter((m) => m.fixture.group != null),
    [actualState.resolvedMatches],
  );

  const groupMatches = useMemo(
    () => filterGroupMatchesByTeam(allGroupMatches, selectedTeamId),
    [allGroupMatches, selectedTeamId],
  );

  const teamsById = useMemo(() => {
    const map = new Map<number, (typeof actualState.resolvedMatches)[0]['homeTeam']>();
    for (const m of actualState.resolvedMatches) {
      if (m.homeTeam) map.set(m.homeTeam.id, m.homeTeam);
      if (m.awayTeam) map.set(m.awayTeam.id, m.awayTeam);
    }
    return map;
  }, [actualState.resolvedMatches]);

  const selectedTeam = selectedTeamId != null ? teamsById.get(selectedTeamId) : null;
  const filterTeamLabel = selectedTeam ? teamCode(selectedTeam) : null;

  const handleSelectTeam = (teamId: number) => {
    setSelectedTeamId((prev) => (prev === teamId ? null : teamId));
    onSelectMatch(null);
  };

  const fixtures = useMemo(
    () => actualState.resolvedMatches.map((m) => m.fixture),
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

  return (
    <GroupPhaseLayout
      standings={
        <div className="group-standings-scroll">
          <GroupTables
            standings={actualState.groupStandings}
            qualifyingThirdGroups={actualState.qualifyingThirdGroups}
            selectedTeamId={selectedTeamId}
            onSelectTeam={handleSelectTeam}
          />
          {(actualState.thirdPlaceOrder ?? []).length > 0 ? (
            <ThirdPlaceEditor
              rows={actualState.thirdPlaceOrder}
              canEdit={canEditThirdPlace}
              onMoveUp={(groupLetter) => onMoveThirdPlaceUp?.(groupLetter)}
              onMoveDown={(groupLetter) => onMoveThirdPlaceDown?.(groupLetter)}
            />
          ) : (
            actualState.qualifyingThirdGroups.length > 0 && (
              <div className="third-place-banner">
                Third-place race: {actualState.qualifyingThirdGroups.join(', ')}
              </div>
            )
          )}
        </div>
      }
      fixtures={
        <FixtureList
          matches={groupMatches}
          selectedMatchNumber={selectedMatchNumber}
          editingMatchNumber={editingMatchNumber}
          filterTeamLabel={filterTeamLabel}
          allowEdit={!readOnly}
          editRecordedResults
          selectOnScoreClick
          canClearMatch={canClearMatch}
          canModifyMatch={canModifyMatch}
          onSelect={onSelectMatch}
          onStartEdit={onStartEdit}
          onSave={onSaveScore}
          onCancelEdit={onCancelEdit}
          onClear={onClearScore}
        />
      }
    />
  );
}
