import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { MasterTeamStats, MasterTeamStatsRow } from '../types.js';
import { TEAM_CODES } from '@shared/lib/teamCodes.js';
import { useSortableTable } from '../lib/useSortableTable.js';
import { SortableTh } from './SortableTh.js';

interface Props {
  onClose: () => void;
  predictionId?: number | null;
  allowRebuild?: boolean;
}

type StatsSortKey = 'code' | 'team' | 'avgGoals' | 'titles';

function teamCodeForRow(row: MasterTeamStatsRow): string {
  return TEAM_CODES[row.teamName] ?? row.teamName.slice(0, 3).toUpperCase();
}

const STATS_COMPARATORS: Record<StatsSortKey, (a: MasterTeamStatsRow, b: MasterTeamStatsRow) => number> =
  {
    code: (a, b) => teamCodeForRow(a).localeCompare(teamCodeForRow(b)) || a.teamName.localeCompare(b.teamName),
    team: (a, b) => a.teamName.localeCompare(b.teamName),
    avgGoals: (a, b) =>
      a.avgGoalsPerSimulation - b.avgGoalsPerSimulation || a.teamName.localeCompare(b.teamName),
    titles: (a, b) => a.championWins - b.championWins || a.teamName.localeCompare(b.teamName),
  };

export function MasterTeamStatsModal({ onClose, predictionId = null, allowRebuild = true }: Props) {
  const [stats, setStats] = useState<MasterTeamStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teams = stats?.teams ?? [];
  const { sortedItems, sort, toggleSort } = useSortableTable(
    teams,
    { key: 'avgGoals', direction: 'desc' },
    STATS_COMPARATORS,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await api.getMasterTeamStats(predictionId ?? undefined);
        if (!cancelled) setStats(next);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load team stats');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [predictionId]);

  const handleRebuild = async () => {
    setRebuilding(true);
    setError(null);
    try {
      const next = await api.rebuildMasterTeamStats(predictionId ?? undefined);
      setStats(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rebuild team stats');
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide master-team-stats-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Team statistics</h2>
        <p className="muted master-team-stats-desc">
          {allowRebuild
            ? 'Read from persisted database aggregates for the active prediction. Goals per simulation is the average total goals scored by each team in simulations where they played at least one match. Championships count finals won across completed simulations in the selection.'
            : 'Aggregate statistics for the exported prediction. Goals per simulation is the average total goals scored by each team in simulations where they played at least one match. Championships count finals won across completed simulations.'}
        </p>

        {loading && <p className="muted">Loading…</p>}
        {error && <p className="modal-warning">{error}</p>}

        {stats && !loading && (
          <>
            <p className="master-team-stats-summary">
              {stats.simulationCount.toLocaleString()} simulation
              {stats.simulationCount === 1 ? '' : 's'} in selection
              {stats.teams.length > 0 && (
                <>
                  {' '}
                  · {stats.teams.length} team{stats.teams.length === 1 ? '' : 's'} with match data
                </>
              )}
            </p>

            {stats.teams.length === 0 ? (
              <p className="muted">
                {stats.simulationCount > 0
                  ? 'No persisted team stats yet. Rebuild once from your existing simulation data.'
                  : 'No simulations in this prediction yet.'}
              </p>
            ) : (
              <div className="ratings-table-wrap">
                <table className="ratings-table master-team-stats-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <SortableTh
                        label="Code"
                        sortKey="code"
                        activeKey={sort.key}
                        direction={sort.direction}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="Team"
                        sortKey="team"
                        activeKey={sort.key}
                        direction={sort.direction}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="Goals / sim"
                        sortKey="avgGoals"
                        activeKey={sort.key}
                        direction={sort.direction}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="Titles"
                        sortKey="titles"
                        activeKey={sort.key}
                        direction={sort.direction}
                        onSort={toggleSort}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((row, index) => (
                      <tr key={row.teamId}>
                        <td>{index + 1}</td>
                        <td>{teamCodeForRow(row)}</td>
                        <td>
                          {row.flag} {row.teamName}
                        </td>
                        <td>{row.avgGoalsPerSimulation.toFixed(2)}</td>
                        <td>{row.championWins.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <div className="modal-actions">
          {allowRebuild && (
            <button
              type="button"
              className="btn btn-simulate"
              disabled={loading || rebuilding}
              onClick={handleRebuild}
            >
              {rebuilding ? 'Rebuilding…' : 'Rebuild from database'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
