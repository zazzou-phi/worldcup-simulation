import { useEffect, useMemo, useState } from 'react';
import { filterGroupMatchesByTeam } from '@shared/engine/matchFilters.js';
import { teamCode } from '@shared/lib/teamCodes.js';
import {
  MAX_DOUBLE_DOWN,
  pickDoubleDownMatches,
} from '../lib/doubleDown.js';
import type { MasterGroupState } from '../types.js';
import { GroupTables } from './GroupTables.js';
import { FixtureList } from './FixtureList.js';
import { MasterFixtureModal } from './MasterFixtureModal.js';

interface Props {
  masterState: MasterGroupState;
  layout: 'horizontal' | 'vertical';
}

export function MasterGroupView({ masterState, layout }: Props) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [selectedMatchNumber, setSelectedMatchNumber] = useState<number | null>(null);
  const [modalMatchNumber, setModalMatchNumber] = useState<number | null>(null);
  const [doubleCount, setDoubleCount] = useState(MAX_DOUBLE_DOWN);

  useEffect(() => {
    setSelectedTeamId(null);
    setSelectedMatchNumber(null);
    setModalMatchNumber(null);
  }, [masterState.resolvedMatches.length, masterState.groupStandings.length]);

  const allGroupMatches = useMemo(
    () => masterState.resolvedMatches.filter((m) => m.fixture.group != null),
    [masterState.resolvedMatches],
  );

  const groupMatches = useMemo(
    () => filterGroupMatchesByTeam(allGroupMatches, selectedTeamId),
    [allGroupMatches, selectedTeamId],
  );

  const teamsById = useMemo(() => {
    const map = new Map<number, (typeof allGroupMatches)[0]['homeTeam']>();
    for (const m of allGroupMatches) {
      if (m.homeTeam) map.set(m.homeTeam.id, m.homeTeam);
      if (m.awayTeam) map.set(m.awayTeam.id, m.awayTeam);
    }
    return map;
  }, [allGroupMatches]);

  const selectedTeam = selectedTeamId != null ? teamsById.get(selectedTeamId) : null;
  const filterTeamLabel = selectedTeam ? teamCode(selectedTeam) : null;

  const modalMatch = modalMatchNumber != null
    ? allGroupMatches.find((m) => m.fixture.matchNumber === modalMatchNumber)
    : null;

  const hasAnyData = Object.values(masterState.distributions).some((d) => d.total > 0);

  const doubledMatchNumbers = useMemo(
    () => pickDoubleDownMatches(masterState.distributions, doubleCount),
    [masterState.distributions, doubleCount],
  );

  const handleSelectTeam = (teamId: number) => {
    setSelectedTeamId((prev) => (prev === teamId ? null : teamId));
    setSelectedMatchNumber(null);
  };

  const handleSelectMatch = (matchNumber: number | null) => {
    setSelectedMatchNumber(matchNumber);
    if (matchNumber == null) return;
    const dist = masterState.distributions[String(matchNumber)];
    if (dist?.total > 0) {
      setModalMatchNumber(matchNumber);
    }
  };

  return (
    <>
      <div className={`group-phase layout-${layout}`}>
        <div className="group-phase-standings">
          {!hasAnyData && (
            <div className="third-place-banner master-empty-banner">
              No group matches played across simulations yet. Run simulations or bulk simulate to
              build consensus.
            </div>
          )}
          {masterState.qualifyingThirdGroups.length > 0 && (
            <div className="third-place-banner">
              Third-place race: {masterState.qualifyingThirdGroups.join(', ')}
            </div>
          )}
          <GroupTables
            standings={masterState.groupStandings}
            qualifyingThirdGroups={masterState.qualifyingThirdGroups}
            selectedTeamId={selectedTeamId}
            onSelectTeam={handleSelectTeam}
          />
        </div>
        <div className="group-phase-fixtures">
          <FixtureList
            matches={groupMatches}
            selectedMatchNumber={selectedMatchNumber}
            editingMatchNumber={null}
            filterTeamLabel={filterTeamLabel}
            allowEdit={false}
            canClearMatch={() => false}
            doubleCount={doubleCount}
            maxDoubleCount={MAX_DOUBLE_DOWN}
            onDoubleCountChange={setDoubleCount}
            doubledMatchNumbers={doubledMatchNumbers}
            onSelect={handleSelectMatch}
            onStartEdit={() => {}}
            onSave={() => {}}
            onCancelEdit={() => {}}
            onClear={() => {}}
          />
        </div>
      </div>

      {modalMatch && (
        <MasterFixtureModal
          match={modalMatch}
          distribution={masterState.distributions[String(modalMatch.fixture.matchNumber)]}
          onClose={() => setModalMatchNumber(null)}
        />
      )}
    </>
  );
}
