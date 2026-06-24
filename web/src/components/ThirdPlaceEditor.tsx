import { Fragment } from 'react';
import { teamCode } from '@shared/lib/teamCodes.js';
import type { ThirdPlaceOrderRow } from '../types.js';

interface Props {
  rows: ThirdPlaceOrderRow[];
  canEdit: boolean;
  onMoveUp: (groupLetter: string) => void;
  onMoveDown: (groupLetter: string) => void;
}

export function ThirdPlaceEditor({ rows, canEdit, onMoveUp, onMoveDown }: Props) {
  if (rows.length === 0) return null;

  return (
    <div className="group-table third-place-editor">
      <div className="group-table-title">Best 3rd placed teams</div>
      <p className="third-place-editor-hint">
        Reorder when tie-breakers differ from the simulator. Top 8 qualify.
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
          {rows.map((row, index) => (
            <Fragment key={row.groupLetter}>
              {index === 8 && (
                <tr className="third-place-qualification-line">
                  <td colSpan={canEdit ? 7 : 6}>
                    <span>Qualification line — top 8 advance</span>
                  </td>
                </tr>
              )}
              <tr
                className={row.qualified ? 'third-place-qualified' : 'third-place-eliminated'}
              >
                <td>{row.position}</td>
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
                      disabled={index === 0}
                      aria-label={`Move ${teamCode(row.team)} up`}
                      onClick={() => onMoveUp(row.groupLetter)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      disabled={index === rows.length - 1}
                      aria-label={`Move ${teamCode(row.team)} down`}
                      onClick={() => onMoveDown(row.groupLetter)}
                    >
                      ↓
                    </button>
                  </td>
                )}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
