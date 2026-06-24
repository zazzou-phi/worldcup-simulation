import { useCallback, useEffect, useMemo, useState } from 'react';
import { canClearSimulationResult, canModifySimulationResult } from '@shared/engine/phase.js';
import { filterGroupMatchesByTeam } from '@shared/engine/matchFilters.js';
import { teamCode } from '@shared/lib/teamCodes.js';
import { deriveGroupStandingsFromState } from '../lib/deriveGroupStandings.js';
import type { TournamentState } from '../types.js';
import { GroupTables } from './GroupTables.js';
import { FixtureList } from './FixtureList.js';
import { GroupPhaseLayout } from './GroupPhaseLayout.js';
import { ThirdPlaceEditor } from './ThirdPlaceEditor.js';

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

export function GroupPhaseView({
  state,
  selectedMatchNumber,
  editingMatchNumber,
  simulating = false,
  onSelectMatch,
  onStartEdit,
  onSimulateMatch,
  onSaveScore,
  onCancelEdit,
  onClearScore,
}: Props) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  useEffect(() => {
    setSelectedTeamId(null);
  }, [state.simulation.id]);

  const allGroupMatches = useMemo(
    () => state.resolvedMatches.filter((m) => m.fixture.group != null),
    [state.resolvedMatches],
  );

  const groupMatches = useMemo(
    () => filterGroupMatchesByTeam(allGroupMatches, selectedTeamId),
    [allGroupMatches, selectedTeamId],
  );

  const selectedTeam = selectedTeamId != null ? state.teams[String(selectedTeamId)] : null;
  const filterTeamLabel = selectedTeam ? teamCode(selectedTeam) : null;

  const handleSelectTeam = (teamId: number) => {
    setSelectedTeamId((prev) => (prev === teamId ? null : teamId));
    onSelectMatch(null);
  };

  const { groupStandings, qualifyingThirdGroups } = useMemo(
    () => deriveGroupStandingsFromState(state),
    [state],
  );

  const lockedMatchNumbers = useMemo(
    () => new Set(state.actualResults.map((result) => result.matchNumber)),
    [state.actualResults],
  );

  const canModifyMatch = useCallback(
    (matchNumber: number) =>
      canModifySimulationResult(matchNumber, state.matches, state.fixtures, lockedMatchNumbers),
    [state.matches, state.fixtures, lockedMatchNumbers],
  );

  const canClearMatch = useCallback(
    (matchNumber: number) =>
      canClearSimulationResult(matchNumber, state.matches, state.fixtures, lockedMatchNumbers),
    [state.matches, state.fixtures, lockedMatchNumbers],
  );

  return (
    <GroupPhaseLayout
      standings={
        <div className="group-standings-scroll">
          <GroupTables
            standings={groupStandings}
            qualifyingThirdGroups={
              (state.thirdPlaceOrder?.length ?? 0) > 0
                ? state.qualifyingThirdGroups
                : qualifyingThirdGroups
            }
            selectedTeamId={selectedTeamId}
            onSelectTeam={handleSelectTeam}
          />
          {state.thirdPlaceOrder?.length > 0 ? (
            <ThirdPlaceEditor
              rows={state.thirdPlaceOrder}
              canEdit={false}
              onMoveUp={() => {}}
              onMoveDown={() => {}}
            />
          ) : (
            qualifyingThirdGroups.length > 0 && (
              <div className="third-place-banner">
                Third-place race: {qualifyingThirdGroups.join(', ')}
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
          actualResults={state.actualResults}
          hidePredictedWhenLocked
          canClearMatch={canClearMatch}
          canModifyMatch={canModifyMatch}
          simulating={simulating}
          onSelect={onSelectMatch}
          onStartEdit={onStartEdit}
          onSimulateMatch={onSimulateMatch}
          onSave={onSaveScore}
          onCancelEdit={onCancelEdit}
          onClear={onClearScore}
        />
      }
    />
  );
}
