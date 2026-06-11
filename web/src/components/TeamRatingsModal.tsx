import { useMemo, useState } from 'react';
import type { Team } from '../types.js';
import { teamCode } from '@shared/lib/teamCodes.js';
import { useSortableTable } from '../lib/useSortableTable.js';
import { SortableTh } from './SortableTh.js';

interface Props {
  teams: Team[];
  onClose: () => void;
  onSave: (teamId: number, offensiveRating: number, defensiveRating: number) => void;
}

type RatingsSortKey = 'rank' | 'code' | 'team' | 'offensive' | 'defensive';

export function TeamRatingsModal({ teams, onClose, onSave }: Props) {
  const comparators = useMemo<Record<RatingsSortKey, (a: Team, b: Team) => number>>(
    () => ({
      rank: (a, b) => a.rank - b.rank || a.name.localeCompare(b.name),
      code: (a, b) => teamCode(a).localeCompare(teamCode(b)) || a.name.localeCompare(b.name),
      team: (a, b) => a.name.localeCompare(b.name),
      offensive: (a, b) =>
        a.offensiveRating - b.offensiveRating || a.name.localeCompare(b.name),
      defensive: (a, b) =>
        a.defensiveRating - b.defensiveRating || a.name.localeCompare(b.name),
    }),
    [],
  );

  const { sortedItems, sort, toggleSort } = useSortableTable(
    teams,
    { key: 'rank', direction: 'asc' },
    comparators,
  );

  const [selectedId, setSelectedId] = useState(sortedItems[0]?.id ?? 0);
  const [editing, setEditing] = useState(false);
  const [offensive, setOffensive] = useState('');
  const [defensive, setDefensive] = useState('');

  const selected = sortedItems.find((t) => t.id === selectedId);

  const startEdit = () => {
    if (!selected) return;
    setOffensive(selected.offensiveRating.toFixed(3));
    setDefensive(selected.defensiveRating.toFixed(3));
    setEditing(true);
  };

  const saveEdit = () => {
    const o = parseFloat(offensive);
    const d = parseFloat(defensive);
    if (!Number.isFinite(o) || !Number.isFinite(d) || o < 0 || d < 0) return;
    onSave(selectedId, o, d);
    setEditing(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Team ratings</h2>

        {!editing ? (
          <>
            <div className="ratings-table-wrap">
              <table className="ratings-table">
                <thead>
                  <tr>
                    <SortableTh
                      label="#"
                      sortKey="rank"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={toggleSort}
                    />
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
                      label="Off"
                      sortKey="offensive"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={toggleSort}
                    />
                    <SortableTh
                      label="Def"
                      sortKey="defensive"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={toggleSort}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((team) => (
                    <tr
                      key={team.id}
                      className={team.id === selectedId ? 'selected' : undefined}
                      onClick={() => setSelectedId(team.id)}
                      onDoubleClick={startEdit}
                    >
                      <td>{team.rank}</td>
                      <td>{teamCode(team)}</td>
                      <td>{team.flag} {team.name}</td>
                      <td>{team.offensiveRating.toFixed(3)}</td>
                      <td>{team.defensiveRating.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={startEdit}>
                Edit selected
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p>{selected?.name}</p>
            <div className="ratings-edit">
              <label>
                Offensive
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  value={offensive}
                  onChange={(e) => setOffensive(e.target.value)}
                />
              </label>
              <label>
                Defensive
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  value={defensive}
                  onChange={(e) => setDefensive(e.target.value)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={saveEdit}>
                Save
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
