import { useEffect, useMemo, useState } from 'react';
import { filterGroupMatchesByTeam } from '@shared/engine/matchFilters.js';
import { teamCode } from '@shared/lib/teamCodes.js';
import {
  loadStoredFixedDoubleDowns,
  storeFixedDoubleDowns,
} from '../lib/fixedDoubleDowns.js';
import {
  MAX_DOUBLE_DOWN,
  buildDoubledMatchNumbers,
} from '../lib/doubleDown.js';
import { isPublicMode } from '../config/appMode.js';
import type { ConsensusMode } from '../lib/consensusMode.js';
import type { ActualMatchResult, Fixture, MasterGroupState, ThirdPlaceOrderRow } from '../types.js';
import { deriveMasterGroupStandings } from '../lib/deriveGroupStandings.js';
import { GroupTables } from './GroupTables.js';
import { FixtureList } from './FixtureList.js';
import { GroupPhaseLayout } from './GroupPhaseLayout.js';
import { MasterFixtureModal } from './MasterFixtureModal.js';
import { ThirdPlaceEditor } from './ThirdPlaceEditor.js';

interface Props {
  predictionId?: number | null;
  masterState: MasterGroupState;
  fixtures: Fixture[];
  groupMemberships: Array<{ groupLetter: string; teamId: number }>;
  actualResults?: ActualMatchResult[];
  thirdPlaceOrder?: ThirdPlaceOrderRow[];
  canEditThirdPlace?: boolean;
  onMoveThirdPlaceUp?: (groupLetter: string) => void;
  onMoveThirdPlaceDown?: (groupLetter: string) => void;
  canEditFrozenConsensus?: boolean;
  savingFrozenConsensus?: boolean;
  onFrozenConsensusModeChange?: (matchNumber: number, mode: ConsensusMode) => void;
}

export function MasterGroupView({
  predictionId = null,
  masterState,
  fixtures,
  groupMemberships,
  actualResults = [],
  thirdPlaceOrder,
  canEditThirdPlace = false,
  onMoveThirdPlaceUp,
  onMoveThirdPlaceDown,
  canEditFrozenConsensus = false,
  savingFrozenConsensus = false,
  onFrozenConsensusModeChange,
}: Props) {
  const publicMode = isPublicMode();
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [selectedMatchNumber, setSelectedMatchNumber] = useState<number | null>(null);
  const [modalMatchNumber, setModalMatchNumber] = useState<number | null>(null);
  const [fixedDoubledMatches, setFixedDoubledMatches] = useState<Set<number>>(() => new Set());

  const actualMatchNumbers = useMemo(
    () => new Set(actualResults.map((r) => r.matchNumber)),
    [actualResults],
  );

  const persistFixedDoubledMatches = (next: Set<number>) => {
    if (publicMode || predictionId == null) return;
    storeFixedDoubleDowns(predictionId, next);
  };

  useEffect(() => {
    setSelectedTeamId(null);
    setSelectedMatchNumber(null);
    setModalMatchNumber(null);
  }, [masterState.resolvedMatches.length, masterState.groupStandings.length]);

  useEffect(() => {
    if (publicMode || predictionId == null) {
      setFixedDoubledMatches(new Set());
      return;
    }
    setFixedDoubledMatches(loadStoredFixedDoubleDowns(predictionId));
  }, [predictionId, publicMode]);

  useEffect(() => {
    if (publicMode || predictionId == null || actualMatchNumbers.size === 0) return;
    setFixedDoubledMatches((prev) => {
      const next = new Set([...prev].filter((matchNumber) => actualMatchNumbers.has(matchNumber)));
      if (next.size === prev.size) return prev;
      persistFixedDoubledMatches(next);
      return next;
    });
  }, [actualMatchNumbers, predictionId, publicMode]);

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

  const fixedDoubleCount = useMemo(() => {
    let count = 0;
    for (const matchNumber of fixedDoubledMatches) {
      if (actualMatchNumbers.has(matchNumber)) count++;
    }
    return count;
  }, [fixedDoubledMatches, actualMatchNumbers]);

  const doubledMatchNumbers = useMemo(() => {
    if (publicMode) return undefined;
    return buildDoubledMatchNumbers(
      fixedDoubledMatches,
      allGroupMatches,
      masterState.distributions,
      masterState.consensusMode,
      MAX_DOUBLE_DOWN,
      actualMatchNumbers,
      masterState.sampleResults,
    );
  }, [
    allGroupMatches,
    masterState.consensusMode,
    masterState.distributions,
    masterState.sampleResults,
    publicMode,
    fixedDoubledMatches,
    actualMatchNumbers,
  ]);

  const handleToggleFixedDouble = (matchNumber: number) => {
    if (!actualMatchNumbers.has(matchNumber)) return;
    setFixedDoubledMatches((prev) => {
      const next = new Set(prev);
      if (next.has(matchNumber)) {
        next.delete(matchNumber);
      } else {
        if (next.size >= MAX_DOUBLE_DOWN) return prev;
        next.add(matchNumber);
      }
      persistFixedDoubledMatches(next);
      return next;
    });
  };

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
          <div className="group-standings-scroll">
            {!hasAnyData && (
              <div className="third-place-banner master-empty-banner">
                No group matches played across simulations yet. Run simulations or bulk simulate to
                build consensus.
              </div>
            )}
            <GroupTables
              standings={groupStandings}
              qualifyingThirdGroups={qualifyingThirdGroups}
              selectedTeamId={selectedTeamId}
              onSelectTeam={handleSelectTeam}
            />
            {thirdPlaceOrder && thirdPlaceOrder.length > 0 ? (
              <ThirdPlaceEditor
                rows={thirdPlaceOrder}
                canEdit={canEditThirdPlace}
                onMoveUp={(groupLetter) => onMoveThirdPlaceUp?.(groupLetter)}
                onMoveDown={(groupLetter) => onMoveThirdPlaceDown?.(groupLetter)}
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
            editingMatchNumber={null}
            filterTeamLabel={filterTeamLabel}
            actualResults={actualResults}
            allowEdit={false}
            canClearMatch={() => false}
            doubleCount={publicMode ? undefined : MAX_DOUBLE_DOWN}
            fixedDoubleCount={publicMode ? undefined : fixedDoubleCount}
            doubledMatchNumbers={doubledMatchNumbers}
            actualMatchNumbers={publicMode ? undefined : actualMatchNumbers}
            onToggleFixedDouble={publicMode ? undefined : handleToggleFixedDouble}
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
          consensusMode={masterState.consensusMode}
          canEditFrozenConsensus={canEditFrozenConsensus}
          savingFrozenConsensus={savingFrozenConsensus}
          onFrozenConsensusModeChange={onFrozenConsensusModeChange}
          onClose={() => setModalMatchNumber(null)}
        />
      )}
    </>
  );
}
