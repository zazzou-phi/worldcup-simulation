import { Fragment, useMemo } from 'react';
import { teamCode } from '@shared/lib/teamCodes.js';
import { areThirdPlaceTeamsTiedOnStats } from '@shared/engine/thirdPlaceOrder.js';
import type { ThirdPlaceOrderRow } from '../types.js';

interface Props {
  rows: ThirdPlaceOrderRow[];
  canEdit: boolean;
  onMoveUp: (groupLetter: string) => void;
  onMoveDown: (groupLetter: string) => void;
}

export function ThirdPlaceEditor({ rows, canEdit, onMoveUp, onMoveDown }: Props) {
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.position - b.position),
    [rows],
  );

  if (sortedRows.length === 0) return null;

  return (
    <div className="group-table third-place-editor">
      <div className="group-table-title">Best 3rd placed teams</div>
      <p className="third-place-editor-hint">
        Ranked by pts, GD, then GF. Reorder tied teams only (e.g. fair play / yellow cards). Top 8
        qualify.
      </p>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Grp</th>
            <th>Team</th>
            <th>Pts</th>
            <th>GD</th>
            <th>GF</th>
            {canEdit && <th aria-label="Reorder" />}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => {
            const neighborAbove = index > 0 ? sortedRows[index - 1]! : null;
            const neighborBelow = index < sortedRows.length - 1 ? sortedRows[index + 1]! : null;
            const canMoveUp =
              canEdit && neighborAbove != null && areThirdPlaceTeamsTiedOnStats(row, neighborAbove);
            const canMoveDown =
              canEdit && neighborBelow != null && areThirdPlaceTeamsTiedOnStats(row, neighborBelow);

            return (
              <Fragment key={row.groupLetter}>
                {index === 8 && (
                  <tr className="third-place-qualification-line">
                    <td colSpan={canEdit ? 7 : 6}>
                      <span>Qualification line — top 8 advance</span>
                    </td>
                  </tr>
                )}
                <tr
                  className={index < 8 ? 'third-place-qualified' : 'third-place-eliminated'}
                >
                  <td>{index + 1}</td>
                  <td>{row.groupLetter}</td>
                  <td>
                    <span className="team-flag">{row.team.flag}</span> {teamCode(row.team)}
                  </td>
                  <td>{row.points}</td>
                  <td>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                  <td>{row.goalsFor}</td>
                  {canEdit && (
                    <td className="third-place-editor-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        disabled={!canMoveUp}
                        title={
                          canMoveUp
                            ? 'Move up within tied teams'
                            : 'Can only reorder teams tied on pts, GD, and GF'
                        }
                        aria-label={`Move ${teamCode(row.team)} up`}
                        onClick={() => onMoveUp(row.groupLetter)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        disabled={!canMoveDown}
                        title={
                          canMoveDown
                            ? 'Move down within tied teams'
                            : 'Can only reorder teams tied on pts, GD, and GF'
                        }
                        aria-label={`Move ${teamCode(row.team)} down`}
                        onClick={() => onMoveDown(row.groupLetter)}
                      >
                        ↓
                      </button>
                    </td>
                  )}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
