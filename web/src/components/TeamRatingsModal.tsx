import { useMemo } from 'react';
import type { Team } from '../types.js';
import { teamCode } from '@shared/lib/teamCodes.js';
import { useSortableTable } from '../lib/useSortableTable.js';
import { SortableTh } from './SortableTh.js';
import { formatRatingEloWeight } from '../lib/ratingEloWeight.js';

interface Props {
  teams: Team[];
  ratingEloWeight: number;
  onClose: () => void;
}

type RatingsSortKey =
  | 'rank'
  | 'code'
  | 'team'
  | 'eloOff'
  | 'eloDef'
  | 'goalOff'
  | 'goalDef'
  | 'blendOff'
  | 'blendDef';

export function TeamRatingsModal({ teams, ratingEloWeight, onClose }: Props) {
  const comparators = useMemo<Record<RatingsSortKey, (a: Team, b: Team) => number>>(
    () => ({
      rank: (a, b) => a.rank - b.rank || a.name.localeCompare(b.name),
      code: (a, b) => teamCode(a).localeCompare(teamCode(b)) || a.name.localeCompare(b.name),
      team: (a, b) => a.name.localeCompare(b.name),
      eloOff: (a, b) =>
        a.eloOffensiveRating - b.eloOffensiveRating || a.name.localeCompare(b.name),
      eloDef: (a, b) =>
        a.eloDefensiveRating - b.eloDefensiveRating || a.name.localeCompare(b.name),
      goalOff: (a, b) =>
        a.goalOffensiveRating - b.goalOffensiveRating || a.name.localeCompare(b.name),
      goalDef: (a, b) =>
        a.goalDefensiveRating - b.goalDefensiveRating || a.name.localeCompare(b.name),
      blendOff: (a, b) =>
        a.blendOffensiveRating - b.blendOffensiveRating || a.name.localeCompare(b.name),
      blendDef: (a, b) =>
        a.blendDefensiveRating - b.blendDefensiveRating || a.name.localeCompare(b.name),
    }),
    [],
  );

  const { sortedItems, sort, toggleSort } = useSortableTable(
    teams,
    { key: 'blendOff', direction: 'desc' },
    comparators,
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Team ratings</h2>
        <p className="muted ratings-modal-hint">
          Simulations use blended ratings at {formatRatingEloWeight(ratingEloWeight)}. Elo and
          goal columns are reference only.
        </p>

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
                  label="Blend Off"
                  sortKey="blendOff"
                  activeKey={sort.key}
                  direction={sort.direction}
                  onSort={toggleSort}
                />
                <SortableTh
                  label="Blend Def"
                  sortKey="blendDef"
                  activeKey={sort.key}
                  direction={sort.direction}
                  onSort={toggleSort}
                />
                <SortableTh
                  label="Elo Off"
                  sortKey="eloOff"
                  activeKey={sort.key}
                  direction={sort.direction}
                  onSort={toggleSort}
                />
                <SortableTh
                  label="Elo Def"
                  sortKey="eloDef"
                  activeKey={sort.key}
                  direction={sort.direction}
                  onSort={toggleSort}
                />
                <SortableTh
                  label="Goal Off"
                  sortKey="goalOff"
                  activeKey={sort.key}
                  direction={sort.direction}
                  onSort={toggleSort}
                />
                <SortableTh
                  label="Goal Def"
                  sortKey="goalDef"
                  activeKey={sort.key}
                  direction={sort.direction}
                  onSort={toggleSort}
                />
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((team) => (
                <tr key={team.id}>
                  <td>{team.rank}</td>
                  <td>{teamCode(team)}</td>
                  <td>
                    {team.flag} {team.name}
                  </td>
                  <td className="ratings-active-col">{team.blendOffensiveRating.toFixed(3)}</td>
                  <td className="ratings-active-col">{team.blendDefensiveRating.toFixed(3)}</td>
                  <td>{team.eloOffensiveRating.toFixed(3)}</td>
                  <td>{team.eloDefensiveRating.toFixed(3)}</td>
                  <td>{team.goalOffensiveRating.toFixed(3)}</td>
                  <td>{team.goalDefensiveRating.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
