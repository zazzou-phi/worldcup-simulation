import { useEffect, useMemo, useState } from 'react';
import { SIMULATION_KNOCKOUT_ROUNDS } from '@shared/engine/simulationRounds.js';
import type { KnockoutRoundAvailability } from '../types.js';
import type { ConsensusMode } from '../lib/consensusMode.js';
import { formatConsensusMode } from '../lib/consensusMode.js';
import { UpsetFactorControl } from './UpsetFactorControl.js';
import { RatingEloWeightControl } from './RatingEloWeightControl.js';
import { TournamentFormControl } from './TournamentFormControl.js';

const KNOCKOUT_ROUND_LABELS: Record<string, string> = {
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-final',
  semi_final: 'Semi-final',
  third_place: 'Third place',
  final: 'Final',
};

export const DEFAULT_PREDICTION_KNOCKOUT_MC_COUNT = 10_000;

function defaultRoundName(rounds: KnockoutRoundAvailability[]): string {
  const next = rounds.find((round) => round.canSimulate);
  if (next) return next.name;
  const latestComplete = [...rounds].reverse().find((round) => round.isComplete);
  if (latestComplete) return latestComplete.name;
  return SIMULATION_KNOCKOUT_ROUNDS[0]!.name;
}

interface Props {
  running: boolean;
  progress: { roundLabel: string; matchCount: number; simulationCount: number } | null;
  error: string | null;
  rounds: KnockoutRoundAvailability[];
  groupStageComplete: boolean;
  consensusMode: ConsensusMode;
  consensusModeDirty: boolean;
  upsetVariance: number;
  ratingEloWeight: number;
  tournamentEloDeltaWeight: number;
  mcCount: number;
  onUpsetVarianceChange: (value: number) => void;
  onRatingEloWeightChange: (value: number) => void;
  onTournamentEloDeltaWeightChange: (value: number) => void;
  onMcCountChange: (value: number) => void;
  onClose: () => void;
  onRun: (roundName: string, count: number, resimulate: boolean) => void;
}

export function PredictionKnockoutBulkModal({
  running,
  progress,
  error,
  rounds,
  groupStageComplete,
  consensusMode,
  consensusModeDirty,
  upsetVariance,
  ratingEloWeight,
  tournamentEloDeltaWeight,
  mcCount,
  onUpsetVarianceChange,
  onRatingEloWeightChange,
  onTournamentEloDeltaWeightChange,
  onMcCountChange,
  onClose,
  onRun,
}: Props) {
  const [roundName, setRoundName] = useState(() => defaultRoundName(rounds));
  const [countInput, setCountInput] = useState(String(mcCount));
  const [resimulate, setResimulate] = useState(false);

  const selectedRound = useMemo(
    () => rounds.find((round) => round.name === roundName),
    [rounds, roundName],
  );

  useEffect(() => {
    if (!running) {
      setCountInput(String(mcCount));
    }
  }, [mcCount, running]);

  useEffect(() => {
    if (selectedRound?.isComplete) {
      setResimulate(true);
    } else {
      setResimulate(false);
    }
  }, [selectedRound?.isComplete, roundName]);

  const laterRoundsComplete = useMemo(() => {
    if (!selectedRound) return false;
    const selectedIndex = SIMULATION_KNOCKOUT_ROUNDS.findIndex((round) => round.name === roundName);
    if (selectedIndex < 0) return false;
    return rounds
      .slice(selectedIndex + 1)
      .some((round) => round.isComplete);
  }, [rounds, roundName, selectedRound]);

  const handleRun = () => {
    const count = parseInt(countInput, 10);
    if (!Number.isInteger(count) || count < 1 || count > 100_000) return;
    onMcCountChange(count);
    onRun(roundName, count, resimulate);
  };

  const canRunFirstTime = Boolean(selectedRound?.canSimulate);
  const canRunResimulate = Boolean(selectedRound?.isComplete && resimulate);
  const canRun = groupStageComplete && !consensusModeDirty && (canRunFirstTime || canRunResimulate);

  const matchCount = selectedRound?.matches.length ?? 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-wide monte-carlo-modal prediction-knockout-bulk-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Simulate knockout round</h2>
        <p className="muted monte-carlo-desc">
          Run many Monte Carlo regulation simulations for every matchup in one round, then apply the
          saved consensus mode to pick a scoreline per fixture. Draws go to penalties. Re-simulating
          replaces that round&apos;s results (and clears later rounds if needed).
        </p>

        <p className="prediction-knockout-bulk-consensus">
          Consensus mode: <strong>{formatConsensusMode(consensusMode)}</strong>
          {consensusModeDirty ? (
            <span className="modal-warning"> — save in ⋮ before running</span>
          ) : null}
        </p>

        {!groupStageComplete && (
          <p className="modal-warning">
            Complete all group fixtures in the prediction view before simulating knockouts.
          </p>
        )}

        <label className="modal-label" htmlFor="prediction-knockout-round">
          Round
        </label>
        <select
          id="prediction-knockout-round"
          className="modal-input"
          value={roundName}
          disabled={running}
          onChange={(e) => setRoundName(e.target.value)}
        >
          {SIMULATION_KNOCKOUT_ROUNDS.map((round) => {
            const availability = rounds.find((entry) => entry.name === round.name);
            const label = KNOCKOUT_ROUND_LABELS[round.name] ?? round.name;
            const suffix = availability?.isComplete ? ' ✓' : '';
            return (
              <option key={round.name} value={round.name}>
                {label}
                {suffix}
              </option>
            );
          })}
        </select>

        {selectedRound && !selectedRound.canSimulate && !selectedRound.isComplete && (
          <p className="modal-warning">{selectedRound.disabledReason}</p>
        )}

        <label className="modal-label" htmlFor="prediction-knockout-count">
          Simulations per match
        </label>
        <input
          id="prediction-knockout-count"
          className="modal-input"
          type="number"
          min={1}
          max={100000}
          step={100}
          value={countInput}
          disabled={running}
          onChange={(e) => setCountInput(e.target.value)}
        />
        {matchCount > 0 && (
          <p className="muted prediction-knockout-bulk-total">
            {matchCount} matches × {parseInt(countInput, 10) || mcCount} simulations ={' '}
            {(matchCount * (parseInt(countInput, 10) || mcCount)).toLocaleString()} total draws
          </p>
        )}

        <UpsetFactorControl
          id="prediction-knockout-upset"
          variant="full"
          value={upsetVariance}
          disabled={running}
          onChange={onUpsetVarianceChange}
        />

        <RatingEloWeightControl
          id="prediction-knockout-rating-elo-weight"
          variant="full"
          value={ratingEloWeight}
          disabled={running}
          onChange={onRatingEloWeightChange}
        />

        <TournamentFormControl
          id="prediction-knockout-tournament-form"
          variant="full"
          value={tournamentEloDeltaWeight}
          disabled={running}
          onChange={onTournamentEloDeltaWeightChange}
        />

        {selectedRound?.isComplete && (
          <label className="prediction-knockout-bulk-resimulate">
            <input
              type="checkbox"
              checked={resimulate}
              disabled={running}
              onChange={(e) => setResimulate(e.target.checked)}
            />
            Re-simulate this round (replace existing results)
          </label>
        )}

        {resimulate && laterRoundsComplete && (
          <p className="modal-warning">
            Later knockout rounds will be cleared before re-simulating this round.
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-simulate" disabled={running || !canRun} onClick={handleRun}>
            {running ? 'Simulating…' : selectedRound?.isComplete && resimulate ? 'Re-simulate round' : 'Simulate round'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={running} onClick={onClose}>
            Close
          </button>
        </div>

        {running && progress && (
          <div className="monte-carlo-progress" aria-live="polite">
            <div className="monte-carlo-progress-header">
              <span>
                {progress.roundLabel}: {progress.simulationCount.toLocaleString()} simulations ×{' '}
                {progress.matchCount} matches
              </span>
            </div>
          </div>
        )}

        {error && <p className="modal-warning">{error}</p>}
      </div>
    </div>
  );
}
