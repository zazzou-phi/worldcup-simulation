import { useEffect, useState } from 'react';
import type { MonteCarloResult } from '../types.js';
import { TEAM_CODES } from '@shared/lib/teamCodes.js';

const DEFAULT_UPSET_VARIANCE = 0.6;
const UPSET_VARIANCE_MAX = 5;

interface Props {
  running: boolean;
  progress: { completed: number; total: number } | null;
  result: MonteCarloResult | null;
  error: string | null;
  onClose: () => void;
  onRun: (count: number, upsetVariance: number) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function MonteCarloModal({ running, progress, result, error, onClose, onRun }: Props) {
  const [countInput, setCountInput] = useState('1000');
  const [upsetVariance, setUpsetVariance] = useState(DEFAULT_UPSET_VARIANCE);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);

  useEffect(() => {
    if (running) {
      setRunStartedAt(performance.now());
    } else {
      setRunStartedAt(null);
    }
  }, [running]);

  const handleRun = () => {
    const count = parseInt(countInput, 10);
    if (!Number.isInteger(count) || count < 1) return;
    onRun(count, upsetVariance);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide monte-carlo-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Bulk tournament simulation</h2>
        <p className="muted monte-carlo-desc">
          Run many full tournaments using current team ratings and any locked actual results. Each
          tournament is saved as a simulation you can inspect later. Results show how often each
          team wins the final.
        </p>

        <label className="modal-label" htmlFor="monte-carlo-count">
          Number of tournaments
        </label>
        <input
          id="monte-carlo-count"
          className="modal-input"
          type="number"
          min={1}
          max={100000}
          step={1}
          value={countInput}
          disabled={running}
          onChange={(e) => setCountInput(e.target.value)}
        />

        <label className="modal-label" htmlFor="monte-carlo-upset">
          Upset factor{' '}
          <span className="muted monte-carlo-upset-value">{upsetVariance.toFixed(2)}</span>
        </label>
        <input
          id="monte-carlo-upset"
          className="modal-range"
          type="range"
          min={0}
          max={UPSET_VARIANCE_MAX}
          step={0.05}
          value={upsetVariance}
          disabled={running}
          onChange={(e) => setUpsetVariance(parseFloat(e.target.value))}
        />
        <p className="muted monte-carlo-upset-hint">
          Higher values add more random form swings — favorites stumble, underdogs punch above
          their weight. 0 turns upsets off.
        </p>

        <div className="modal-actions">
          <button type="button" className="btn btn-simulate" disabled={running} onClick={handleRun}>
            {running ? 'Simulating…' : 'Run'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={running} onClick={onClose}>
            Close
          </button>
        </div>

        {running && progress && (
          <div className="monte-carlo-progress" aria-live="polite">
            <div className="monte-carlo-progress-header">
              <span>
                {progress.completed.toLocaleString()} / {progress.total.toLocaleString()} tournaments
              </span>
              <span>{Math.round((progress.completed / progress.total) * 100)}%</span>
            </div>
            <div
              className="monte-carlo-progress-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.completed}
            >
              <div
                className="monte-carlo-progress-fill"
                style={{ width: `${(progress.completed / progress.total) * 100}%` }}
              />
            </div>
            {progress.completed > 0 && runStartedAt != null && (
              <p className="muted monte-carlo-progress-eta">
                About{' '}
                {formatDuration(
                  ((performance.now() - runStartedAt) / progress.completed) *
                    (progress.total - progress.completed),
                )}{' '}
                remaining
              </p>
            )}
          </div>
        )}

        {error && <p className="modal-warning">{error}</p>}

        {result && (
          <div className="monte-carlo-results">
            <p className="monte-carlo-summary">
              Simulated {result.count.toLocaleString()} tournaments in{' '}
              {result.elapsedMs < 1000
                ? `${Math.round(result.elapsedMs)} ms`
                : `${(result.elapsedMs / 1000).toFixed(1)} s`}
            </p>
            <p className="muted monte-carlo-batch">
              Saved as simulations {result.firstSimulationId}–{result.lastSimulationId} (
              {result.batchName})
            </p>
            <div className="ratings-table-wrap">
              <table className="ratings-table monte-carlo-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Code</th>
                    <th>Team</th>
                    <th>Wins</th>
                    <th>Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {result.champions.map((row, index) => (
                    <tr key={row.teamId}>
                      <td>{index + 1}</td>
                      <td>{TEAM_CODES[row.teamName] ?? row.teamName.slice(0, 3).toUpperCase()}</td>
                      <td>
                        {row.flag} {row.teamName}
                      </td>
                      <td>{row.wins.toLocaleString()}</td>
                      <td>{row.winPct.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
