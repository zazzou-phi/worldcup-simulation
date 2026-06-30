import { useEffect, useMemo, useState } from 'react';
import {
  buildKnockoutR32DoubledMatchNumbers,
  KNOCKOUT_R32_DOUBLE_DOWN_COUNT,
  KNOCKOUT_R32_MATCH_NUMBERS,
} from '../lib/doubleDown.js';
import {
  loadStoredKnockoutR32FixedDoubleDowns,
  storeKnockoutR32FixedDoubleDowns,
} from '../lib/fixedDoubleDowns.js';
import { isPublicMode } from '../config/appMode.js';
import type { ActualMatchResult, MasterKnockoutState } from '../types.js';
import { KnockoutBracket, KnockoutList } from './KnockoutBracket.js';
import { KnockoutPhaseLayout } from './KnockoutPhaseLayout.js';
import { MasterFixtureModal } from './MasterFixtureModal.js';

interface Props {
  predictionId: number | null;
  masterKnockoutState: MasterKnockoutState;
  useBracketView: boolean;
  onViewChange: (useBracket: boolean) => void;
  selectedMatchNumber: number | null;
  simulating?: boolean;
  consensusModeDirty?: boolean;
  onSelectMatch: (matchNumber: number | null) => void;
  onSelectKnockoutRun?: (simulationId: number | null) => void;
  onResampleMatch?: (matchNumber: number) => void;
  resamplingMatchNumber?: number | null;
  actualResults?: ActualMatchResult[];
}

export function MasterKnockoutView({
  predictionId,
  masterKnockoutState,
  useBracketView,
  onViewChange,
  selectedMatchNumber,
  simulating = false,
  consensusModeDirty = false,
  onSelectMatch,
  onSelectKnockoutRun,
  onResampleMatch,
  resamplingMatchNumber = null,
  actualResults = [],
}: Props) {
  const publicMode = isPublicMode();
  const knockoutRuns = masterKnockoutState.knockoutRuns ?? [];
  const [modalMatchNumber, setModalMatchNumber] = useState<number | null>(null);
  const [fixedDoubledMatches, setFixedDoubledMatches] = useState<Set<number>>(() => new Set());

  const actualMatchNumbers = useMemo(
    () => new Set(actualResults.map((result) => result.matchNumber)),
    [actualResults],
  );

  const persistFixedDoubledMatches = (next: Set<number>) => {
    if (publicMode || predictionId == null) return;
    storeKnockoutR32FixedDoubleDowns(predictionId, next);
  };

  useEffect(() => {
    if (publicMode || predictionId == null) {
      setFixedDoubledMatches(new Set());
      return;
    }
    setFixedDoubledMatches(loadStoredKnockoutR32FixedDoubleDowns(predictionId));
  }, [predictionId, publicMode]);

  useEffect(() => {
    if (publicMode || predictionId == null || actualMatchNumbers.size === 0) return;
    setFixedDoubledMatches((prev) => {
      const next = new Set(
        [...prev].filter(
          (matchNumber) =>
            KNOCKOUT_R32_MATCH_NUMBERS.has(matchNumber) && actualMatchNumbers.has(matchNumber),
        ),
      );
      if (next.size === prev.size) return prev;
      persistFixedDoubledMatches(next);
      return next;
    });
  }, [actualMatchNumbers, predictionId, publicMode]);

  const fixedDoubleCount = useMemo(() => {
    let count = 0;
    for (const matchNumber of fixedDoubledMatches) {
      if (
        KNOCKOUT_R32_MATCH_NUMBERS.has(matchNumber) &&
        actualMatchNumbers.has(matchNumber)
      ) {
        count++;
      }
    }
    return count;
  }, [fixedDoubledMatches, actualMatchNumbers]);

  const doubledMatchNumbers = useMemo(() => {
    if (publicMode) return undefined;
    return buildKnockoutR32DoubledMatchNumbers(
      fixedDoubledMatches,
      masterKnockoutState.resolvedMatches,
      masterKnockoutState.distributions,
      masterKnockoutState.consensusMode,
      actualMatchNumbers,
    );
  }, [
    actualMatchNumbers,
    fixedDoubledMatches,
    masterKnockoutState.consensusMode,
    masterKnockoutState.distributions,
    masterKnockoutState.resolvedMatches,
    publicMode,
  ]);

  const handleToggleFixedDouble = (matchNumber: number) => {
    if (!KNOCKOUT_R32_MATCH_NUMBERS.has(matchNumber) || !actualMatchNumbers.has(matchNumber)) {
      return;
    }
    setFixedDoubledMatches((prev) => {
      const next = new Set(prev);
      if (next.has(matchNumber)) {
        next.delete(matchNumber);
      } else {
        const r32Fixed = [...next].filter(
          (n) => KNOCKOUT_R32_MATCH_NUMBERS.has(n) && actualMatchNumbers.has(n),
        );
        if (r32Fixed.length >= KNOCKOUT_R32_DOUBLE_DOWN_COUNT) return prev;
        next.add(matchNumber);
      }
      persistFixedDoubledMatches(next);
      return next;
    });
  };

  const modalMatch = useMemo(
    () =>
      modalMatchNumber == null
        ? null
        : masterKnockoutState.resolvedMatches.find(
            (match) => match.fixture.matchNumber === modalMatchNumber,
          ) ?? null,
    [masterKnockoutState.resolvedMatches, modalMatchNumber],
  );

  const handleSelectMatch = (matchNumber: number | null) => {
    onSelectMatch(matchNumber);
    if (matchNumber == null) return;
    const distribution =
      masterKnockoutState.distributions[String(matchNumber)] ??
      masterKnockoutState.distributions[matchNumber as unknown as string];
    if ((distribution?.total ?? 0) > 0) {
      setModalMatchNumber(matchNumber);
    }
  };

  const canResampleMatch = (matchNumber: number) =>
    !actualMatchNumbers.has(matchNumber) &&
    (masterKnockoutState.distributions[String(matchNumber)]?.total ??
      masterKnockoutState.distributions[matchNumber as unknown as string]?.total ??
      0) > 0 &&
    masterKnockoutState.resolvedMatches.find((match) => match.fixture.matchNumber === matchNumber)
      ?.result.status === 'played';

  const matchProps = {
    matches: masterKnockoutState.resolvedMatches,
    selectedMatchNumber,
    editingMatchNumber: null,
    simulating,
    actualResults,
    hidePredictedWhenLocked: true,
    canClearMatch: () => false,
    canModifyMatch: () => false,
    doubleCount: publicMode ? undefined : KNOCKOUT_R32_DOUBLE_DOWN_COUNT,
    fixedDoubleCount: publicMode ? undefined : fixedDoubleCount,
    doubledMatchNumbers,
    actualMatchNumbers,
    onToggleFixedDouble: publicMode ? undefined : handleToggleFixedDouble,
    onSelect: handleSelectMatch,
    onStartEdit: () => {},
    onSave: () => {},
    onCancelEdit: () => {},
    onClear: () => {},
    showSampleResample: !publicMode && onResampleMatch != null,
    canResampleMatch: onResampleMatch != null ? canResampleMatch : undefined,
    resamplingMatchNumber,
    onResampleMatch,
  };

  return (
    <>
      <div className="master-knockout-view">
        <div className="master-knockout-toolbar">
          {masterKnockoutState.groupStageComplete && consensusModeDirty && (
            <p className="master-knockout-notice">
              Save your consensus mode before simulating — knockout uses the saved setting.
            </p>
          )}
          {!masterKnockoutState.groupStageComplete && (
            <p className="master-knockout-notice">
              Complete all group fixtures in the prediction view before simulating knockouts.
            </p>
          )}
          <div className="master-knockout-rounds" aria-label="Knockout round status">
            {masterKnockoutState.rounds.map((round) => (
              <span
                key={round.name}
                className={`master-knockout-round-pill ${
                  round.isComplete ? 'complete' : round.canSimulate ? 'ready' : ''
                }`}
                title={round.disabledReason}
              >
                {round.label}
                {round.isComplete ? ' ✓' : ''}
              </span>
            ))}
          </div>
          {!publicMode && knockoutRuns.length > 0 && onSelectKnockoutRun && (
            <label className="master-knockout-run-select">
              <span className="master-knockout-run-label">Saved run</span>
              <select
                value={masterKnockoutState.activeKnockoutSimulationId ?? ''}
                onChange={(event) => {
                  const raw = event.target.value;
                  onSelectKnockoutRun(raw === '' ? null : Number(raw));
                }}
                aria-label="Load saved knockout run"
              >
                <option value="">Latest consensus</option>
                {knockoutRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <KnockoutPhaseLayout
          useBracketView={useBracketView}
          onViewChange={onViewChange}
          bracket={<KnockoutBracket {...matchProps} />}
          fixtures={<KnockoutList {...matchProps} />}
        />
      </div>

      {modalMatch && (
        <MasterFixtureModal
          match={modalMatch}
          distribution={
            masterKnockoutState.distributions[String(modalMatch.fixture.matchNumber)] ??
            masterKnockoutState.distributions[modalMatch.fixture.matchNumber as unknown as string]
          }
          defaultConsensusMode={masterKnockoutState.consensusMode}
          consensusMode={masterKnockoutState.consensusMode}
          distributionSource="knockout"
          onClose={() => setModalMatchNumber(null)}
        />
      )}
    </>
  );
}
