import { useEffect, useMemo, useState } from 'react';
import { filterGroupMatchesByTeam } from '@shared/engine/matchFilters.js';
import { teamCode } from '@shared/lib/teamCodes.js';
import { deriveGroupStandingsFromState } from '../lib/deriveGroupStandings.js';
import type { TournamentState } from '../types.js';
import { GroupTables } from './GroupTables.js';
import { FixtureList } from './FixtureList.js';

interface Props {
  state: TournamentState;
  layout: 'horizontal' | 'vertical';
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
  layout,
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

  return (
    <div className={`group-phase layout-${layout}`}>
      <div className="group-phase-standings">
        {qualifyingThirdGroups.length > 0 && (
          <div className="third-place-banner">
            Third-place race: {qualifyingThirdGroups.join(', ')}
          </div>
        )}
        <GroupTables
          standings={groupStandings}
          qualifyingThirdGroups={qualifyingThirdGroups}
          selectedTeamId={selectedTeamId}
          onSelectTeam={handleSelectTeam}
        />
      </div>
      <div className="group-phase-fixtures">
        <FixtureList
          matches={groupMatches}
          selectedMatchNumber={selectedMatchNumber}
          editingMatchNumber={editingMatchNumber}
          filterTeamLabel={filterTeamLabel}
          actualResults={state.actualResults}
          simulating={simulating}
          onSelect={onSelectMatch}
          onStartEdit={onStartEdit}
          onSimulateMatch={onSimulateMatch}
          onSave={onSaveScore}
          onCancelEdit={onCancelEdit}
          onClear={onClearScore}
        />
      </div>
    </div>
  );
}
