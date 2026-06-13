import type { ActualMatchResult, ResolvedMatch } from '../types.js';
import { matchTeamName, matchWinnerSide } from '@shared/lib/matchDisplay.js';
import { ScoreDisplay, ScoreEditor } from './ScoreEditor.js';

interface Props {
  matches: ResolvedMatch[];
  selectedMatchNumber: number | null;
  editingMatchNumber: number | null;
  filterTeamLabel?: string | null;
  allowEdit?: boolean;
  clearLockedOnly?: boolean;
  canClearMatch?: (matchNumber: number) => boolean;
  canModifyMatch?: (matchNumber: number) => boolean;
  actualResults?: ActualMatchResult[];
  simulating?: boolean;
  doubleCount?: number;
  maxDoubleCount?: number;
  onDoubleCountChange?: (count: number) => void;
  doubledMatchNumbers?: ReadonlySet<number>;
  onSelect: (matchNumber: number | null) => void;
  onStartEdit: (matchNumber: number) => void;
  onSimulateMatch?: (matchNumber: number) => void;
  onSave: (
    matchNumber: number,
    goalsHome: number,
    goalsAway: number,
    winnerTeamId: number | null,
  ) => void;
  onCancelEdit: () => void;
  onClear: (matchNumber: number) => void;
}

function formatPrefix(round: string, matchNumber: number): string {
  const md = round.replace('Matchday ', '');
  return `MD${md.padStart(2, '0')} #${String(matchNumber).padStart(3)}`;
}

function teamClassName(match: ResolvedMatch, side: 'home' | 'away'): string {
  if (match.fixture.group != null) return '';
  const winnerSide = matchWinnerSide(match);
  if (winnerSide === side) return 'team-winner';
  if (winnerSide != null) return 'team-loser';
  return '';
}

export function FixtureList({
  matches,
  selectedMatchNumber,
  editingMatchNumber,
  filterTeamLabel = null,
  allowEdit = true,
  clearLockedOnly = false,
  canClearMatch,
  canModifyMatch,
  actualResults = [],
  simulating = false,
  doubleCount,
  maxDoubleCount = 10,
  onDoubleCountChange,
  doubledMatchNumbers,
  onSelect,
  onStartEdit,
  onSimulateMatch,
  onSave,
  onCancelEdit,
  onClear,
}: Props) {
  const actualByMatch = new Map(actualResults.map((r) => [r.matchNumber, r]));
  const showDoubleMarks = doubledMatchNumbers != null;

  return (
    <div className="fixture-list">
      <div className="fixture-list-header">
        <span>
          Fixtures ({matches.length})
          {filterTeamLabel ? ` · ${filterTeamLabel}` : ''}
        </span>
        {onDoubleCountChange != null && doubleCount != null && (
          <span className="fixture-double-counter">
            Double
            <button
              type="button"
              className="btn btn-small btn-ghost fixture-double-btn"
              aria-label="Decrease double count"
              disabled={doubleCount <= 0}
              onClick={() => onDoubleCountChange(Math.max(0, doubleCount - 1))}
            >
              −
            </button>
            <span className="fixture-double-value">
              {doubleCount}/{maxDoubleCount}
            </span>
            <button
              type="button"
              className="btn btn-small btn-ghost fixture-double-btn"
              aria-label="Increase double count"
              disabled={doubleCount >= maxDoubleCount}
              onClick={() =>
                onDoubleCountChange(Math.min(maxDoubleCount, doubleCount + 1))
              }
            >
              +
            </button>
          </span>
        )}
      </div>
      <div className="fixture-list-body">
        {matches.map((m) => {
          const num = m.fixture.matchNumber;
          const selected = num === selectedMatchNumber;
          const editing = num === editingMatchNumber;
          const played = m.result.status === 'played';
          const locked = m.isLocked;
          const canEdit =
            allowEdit && !locked && (canModifyMatch == null || canModifyMatch(num));
          const canSimulate = canEdit && !played && onSimulateMatch != null;
          const canClear =
            played &&
            (canClearMatch
              ? canClearMatch(num)
              : clearLockedOnly
                ? locked
                : !locked);
          const pen =
            played &&
            m.result.goalsHome === m.result.goalsAway &&
            m.result.winnerTeamId != null;
          const actual = actualByMatch.get(num);
          const showDouble = showDoubleMarks && played && doubledMatchNumbers!.has(num);

          return (
            <div
              key={num}
              className={`fixture-row ${selected ? 'selected' : ''} ${locked ? 'fixture-locked' : ''}${showDouble ? ' fixture-row-double' : ''}`}
              onClick={() => onSelect(selected ? null : num)}
              onDoubleClick={() => canEdit && onStartEdit(num)}
            >
              <span className="fixture-prefix">
                {formatPrefix(m.fixture.round, num)}
                {locked ? ' 🔒' : ''}
              </span>
              <span
                className={`fixture-home ${teamClassName(m, 'home')}`}
                title={matchTeamName(m, 'home')}
              >
                {matchTeamName(m, 'home')}
              </span>
              <span className="fixture-score">
                {editing && canEdit ? (
                  <ScoreEditor
                    match={m}
                    simulating={simulating}
                    onSimulate={canSimulate ? () => onSimulateMatch!(num) : undefined}
                    onSave={(h, a, w) => onSave(num, h, a, w)}
                    onCancel={onCancelEdit}
                  />
                ) : (
                  <ScoreDisplay
                    goalsHome={m.result.goalsHome}
                    goalsAway={m.result.goalsAway}
                    played={played}
                    pen={pen}
                    actual={actual}
                    canSimulate={canSimulate}
                    simulating={simulating}
                    onClick={() => {
                      if (played && canEdit) {
                        onStartEdit(num);
                      } else if (canSimulate) {
                        onSimulateMatch!(num);
                      }
                    }}
                    onDoubleClick={() => canEdit && onStartEdit(num)}
                  />
                )}
              </span>
              <span
                className={`fixture-away ${teamClassName(m, 'away')}`}
                title={matchTeamName(m, 'away')}
              >
                {matchTeamName(m, 'away')}
              </span>
              <span className="fixture-row-actions">
                {selected && canClear && !editing && (
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClear(num);
                    }}
                  >
                    Clear
                  </button>
                )}
              </span>
              {showDouble && (
                <span className="fixture-double-mark" title="Double down">
                  D
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
