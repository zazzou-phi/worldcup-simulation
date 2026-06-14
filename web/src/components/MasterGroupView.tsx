import { useEffect, useMemo, useState } from 'react';
import { filterGroupMatchesByTeam } from '@shared/engine/matchFilters.js';
import { teamCode } from '@shared/lib/teamCodes.js';
import {
  MAX_DOUBLE_DOWN,
  pickDoubleDownMatches,
} from '../lib/doubleDown.js';
import { isPublicMode } from '../config/appMode.js';
import type { ConsensusMode } from '../lib/consensusMode.js';
import type { ActualMatchResult, Fixture, MasterGroupState } from '../types.js';
import { deriveMasterGroupStandings } from '../lib/deriveGroupStandings.js';
import { GroupTables } from './GroupTables.js';
import { FixtureList } from './FixtureList.js';
import { GroupPhaseLayout } from './GroupPhaseLayout.js';
import { MasterFixtureModal } from './MasterFixtureModal.js';

interface Props {
  masterState: MasterGroupState;
  fixtures: Fixture[];
  groupMemberships: Array<{ groupLetter: string; teamId: number }>;
  actualResults?: ActualMatchResult[];
  canEditFrozenConsensus?: boolean;
  savingFrozenConsensus?: boolean;
  onFrozenConsensusModeChange?: (matchNumber: number, mode: ConsensusMode) => void;
}

export function MasterGroupView({
  masterState,
  fixtures,
  groupMemberships,
  actualResults = [],
  canEditFrozenConsensus = false,
  savingFrozenConsensus = false,
  onFrozenConsensusModeChange,
}: Props) {
  const publicMode = isPublicMode();
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

  const { groupStandings, qualifyingThirdGroups } = useMemo(
    () => deriveMasterGroupStandings(masterState, fixtures, groupMemberships, actualResults),
    [masterState, fixtures, groupMemberships, actualResults],
  );

  const doubledMatchNumbers = useMemo(() => {
    if (publicMode) return undefined;
    const actualEntered = new Set(actualResults.map((r) => r.matchNumber));
    const eligible = new Set(
      Object.keys(masterState.distributions)
        .map(Number)
        .filter((matchNumber) => !actualEntered.has(matchNumber)),
    );
    return pickDoubleDownMatches(masterState.distributions, doubleCount, eligible);
  }, [masterState.distributions, publicMode, doubleCount, actualResults]);

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
      <GroupPhaseLayout
        standings={
          <>
            {!hasAnyData && (
              <div className="third-place-banner master-empty-banner">
                No group matches played across simulations yet. Run simulations or bulk simulate to
                build consensus.
              </div>
            )}
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
          </>
        }
        fixtures={
          <FixtureList
            matches={groupMatches}
            selectedMatchNumber={selectedMatchNumber}
            editingMatchNumber={null}
            filterTeamLabel={filterTeamLabel}
            actualResults={actualResults}
            allowEdit={false}
            canClearMatch={() => false}
            doubleCount={publicMode ? undefined : doubleCount}
            maxDoubleCount={publicMode ? undefined : MAX_DOUBLE_DOWN}
            onDoubleCountChange={publicMode ? undefined : setDoubleCount}
            doubledMatchNumbers={doubledMatchNumbers}
            onSelect={handleSelectMatch}
            onStartEdit={() => {}}
            onSave={() => {}}
            onCancelEdit={() => {}}
            onClear={() => {}}
          />
        }
      />

      {modalMatch && (
        <MasterFixtureModal
          match={modalMatch}
          distribution={masterState.distributions[String(modalMatch.fixture.matchNumber)]}
          defaultConsensusMode={masterState.consensusMode}
          canEditFrozenConsensus={canEditFrozenConsensus}
          savingFrozenConsensus={savingFrozenConsensus}
          onFrozenConsensusModeChange={onFrozenConsensusModeChange}
          onClose={() => setModalMatchNumber(null)}
        />
      )}
    </>
  );
}
