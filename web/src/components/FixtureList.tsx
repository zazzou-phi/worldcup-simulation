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
  hidePredictedWhenLocked?: boolean;
  simulating?: boolean;
  doubleCount?: number;
  fixedDoubleCount?: number;
  doubledMatchNumbers?: ReadonlySet<number>;
  actualMatchNumbers?: ReadonlySet<number>;
  onToggleFixedDouble?: (matchNumber: number) => void;
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
  hidePredictedWhenLocked = false,
  simulating = false,
  doubleCount,
  fixedDoubleCount = 0,
  doubledMatchNumbers,
  actualMatchNumbers,
  onToggleFixedDouble,
  onSelect,
  onStartEdit,
  onSimulateMatch,
  onSave,
  onCancelEdit,
  onClear,
}: Props) {
  const actualByMatch = new Map(actualResults.map((r) => [r.matchNumber, r]));
  const showDoubleMarks = doubledMatchNumbers != null;
  const remainingDoubleCount =
    doubleCount != null ? Math.max(0, doubleCount - fixedDoubleCount) : 0;

  return (
    <div className={`fixture-list${showDoubleMarks ? ' fixture-list-doubles' : ''}`}>
      <div className="fixture-list-header">
        <span>
          Fixtures ({matches.length})
          {filterTeamLabel ? ` · ${filterTeamLabel}` : ''}
        </span>
        {showDoubleMarks && doubleCount != null && (
          <span className="fixture-double-counter">
            Double
            <span className="fixture-double-value" title={`${fixedDoubleCount} fixed on played games`}>
              {remainingDoubleCount}/{doubleCount}
            </span>
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
          const penWinnerSide =
            played &&
            m.result.goalsHome === m.result.goalsAway &&
            m.result.winnerTeamId != null
              ? matchWinnerSide(m)
              : null;
          const actual = actualByMatch.get(num);
          const hidePredicted = hidePredictedWhenLocked && locked && actual != null;
          const hasActual =
            actualMatchNumbers != null ? actualMatchNumbers.has(num) : actual != null;
          const isDoubled = doubledMatchNumbers?.has(num) ?? false;
          const canToggleFixedDouble =
            showDoubleMarks && hasActual && onToggleFixedDouble != null;
          const showAutoDouble =
            showDoubleMarks && played && !hidePredicted && isDoubled && !canToggleFixedDouble;

          return (
            <div
              key={num}
              className={`fixture-row ${selected ? 'selected' : ''} ${locked ? 'fixture-locked' : ''}`}
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
                    penWinnerSide={penWinnerSide}
                    actual={actual}
                    hidePredicted={hidePredicted}
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
              {canToggleFixedDouble ? (
                <button
                  type="button"
                  className={`fixture-double-mark fixture-double-toggle${isDoubled ? ' active' : ''}`}
                  title={isDoubled ? 'Remove fixed double down' : 'Fix as double down'}
                  aria-pressed={isDoubled}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFixedDouble!(num);
                  }}
                >
                  {isDoubled ? 'D' : '·'}
                </button>
              ) : showAutoDouble ? (
                <span className="fixture-double-mark" title="Double down">
                  D
                </span>
              ) : showDoubleMarks ? (
                <span className="fixture-double-mark fixture-double-empty" aria-hidden="true" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
