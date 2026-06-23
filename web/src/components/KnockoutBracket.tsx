import { FINAL_MATCH_NUMBER, KNOCKOUT_ROUNDS } from '@shared/lib/bracket-layout.js';
import {
  bracketDimsForViewport,
  canvasHeight,
  canvasWidth,
  columnLeft,
  computeBracketRows,
  matchNodeHeight,
  matchTop,
  roundColumnWidth,
} from '@shared/lib/bracket-linear.js';
import { matchSideCode, matchWinnerSide } from '@shared/lib/matchDisplay.js';
import { FixturePrefix } from './FixturePrefix.js';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';
import type { ActualMatchResult, ResolvedMatch } from '../types.js';
import { BracketConnectors } from './BracketConnectors.js';
import { FixtureList } from './FixtureList.js';
import { ScoreDisplay, ScoreEditor } from './ScoreEditor.js';

interface Props {
  matches: ResolvedMatch[];
  selectedMatchNumber: number | null;
  editingMatchNumber: number | null;
  simulating?: boolean;
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
  canClearMatch?: (matchNumber: number) => boolean;
  canModifyMatch?: (matchNumber: number) => boolean;
  actualResults?: ActualMatchResult[];
  hidePredictedWhenLocked?: boolean;
}

function teamClassName(match: ResolvedMatch, side: 'home' | 'away'): string {
  const winnerSide = matchWinnerSide(match);
  if (winnerSide === side) return 'team-winner';
  if (winnerSide != null) return 'team-loser';
  return '';
}

function MatchNode({
  match,
  selected,
  editing,
  large = false,
  simulating = false,
  canEdit,
  onSelect,
  onStartEdit,
  onSimulate,
  onSave,
  onCancelEdit,
  actual,
  hidePredicted = false,
}: {
  match: ResolvedMatch;
  selected: boolean;
  editing: boolean;
  large?: boolean;
  simulating?: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onSimulate?: () => void;
  onSave: (h: number, a: number, w: number | null) => void;
  onCancelEdit: () => void;
  actual?: ActualMatchResult;
  hidePredicted?: boolean;
}) {
  const played = match.result.status === 'played';
  const locked = match.isLocked;
  const editable = canEdit && !locked;
  const canSimulate = editable && !played && onSimulate != null;
  const penWinnerSide =
    played &&
    match.result.goalsHome === match.result.goalsAway &&
    match.result.winnerTeamId != null &&
    match.result.penGoalsHome == null
      ? matchWinnerSide(match)
      : null;
  return (
    <div
      className={`bracket-node ${large ? 'bracket-node-final' : ''} ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      onDoubleClick={() => editable && onStartEdit()}
    >
      <FixturePrefix
        round={match.fixture.round}
        date={match.fixture.date}
        time={match.fixture.time}
        locked={locked}
        className="bracket-node-num"
      />
      <div className={`bracket-node-team ${teamClassName(match, 'home')}`}>
        {matchSideCode(match, 'home')}
      </div>
      {editing && editable ? (
        <ScoreEditor
          match={match}
          simulating={simulating}
          onSimulate={canSimulate ? onSimulate : undefined}
          onSave={onSave}
          onCancel={onCancelEdit}
        />
      ) : (
        <ScoreDisplay
          goalsHome={match.result.goalsHome}
          goalsAway={match.result.goalsAway}
          played={played}
          penGoalsHome={match.result.penGoalsHome}
          penGoalsAway={match.result.penGoalsAway}
          penWinnerSide={penWinnerSide}
          actual={actual}
          hidePredicted={hidePredicted}
          canSimulate={canSimulate}
          simulating={simulating}
          onClick={() => {
            if (played && editable) {
              onStartEdit();
            } else if (canSimulate) {
              onSimulate!();
            }
          }}
          onDoubleClick={() => editable && onStartEdit()}
        />
      )}
      <div className={`bracket-node-team ${teamClassName(match, 'away')}`}>
        {matchSideCode(match, 'away')}
      </div>
    </div>
  );
}

export function KnockoutBracket({
  matches,
  selectedMatchNumber,
  editingMatchNumber,
  simulating = false,
  onSelect,
  onStartEdit,
  onSimulateMatch,
  onSave,
  onCancelEdit,
  onClear,
  canModifyMatch,
  actualResults = [],
  hidePredictedWhenLocked = false,
}: Props) {
  const byNumber = new Map(matches.map((m) => [m.fixture.matchNumber, m]));
  const actualByMatch = new Map(actualResults.map((r) => [r.matchNumber, r]));
  const rows = computeBracketRows();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const dims = bracketDimsForViewport(mobile);
  const width = canvasWidth(dims);
  const height = canvasHeight(rows, dims);

  return (
    <div className="knockout-bracket">
      <h2 className="section-title">Bracket</h2>
      <div className="bracket-scroll">
        <div className="bracket-canvas" style={{ width, height }}>
          <BracketConnectors dims={dims} />
          {KNOCKOUT_ROUNDS.map((round, ri) => (
            <div
              key={round.name}
              className="bracket-round-column"
              style={{
                left: columnLeft(ri, dims),
                width: roundColumnWidth(ri, dims),
                height,
              }}
            >
              <h3 className="bracket-round-title">{round.name}</h3>
              {round.matches.map((num) => {
                const m = byNumber.get(num);
                if (!m) return null;
                const large = num === FINAL_MATCH_NUMBER;
                const editable =
                  !m.isLocked && (canModifyMatch == null || canModifyMatch(num));
                const actual = actualByMatch.get(num);
                const hidePredicted = hidePredictedWhenLocked && m.isLocked && actual != null;
                return (
                  <div
                    key={num}
                    className="bracket-round-slot"
                    style={{ top: matchTop(num, rows, dims), height: matchNodeHeight(num, dims) }}
                  >
                    <MatchNode
                      match={m}
                      selected={num === selectedMatchNumber}
                      editing={num === editingMatchNumber}
                      large={large}
                      simulating={simulating}
                      canEdit={editable}
                      onSelect={() => onSelect(num === selectedMatchNumber ? null : num)}
                      onStartEdit={() => onStartEdit(num)}
                      onSimulate={
                        onSimulateMatch ? () => onSimulateMatch(num) : undefined
                      }
                      onSave={(h, a, w) => onSave(num, h, a, w)}
                      onCancelEdit={onCancelEdit}
                      actual={actual}
                      hidePredicted={hidePredicted}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function KnockoutList({
  matches,
  selectedMatchNumber,
  editingMatchNumber,
  simulating = false,
  onSelect,
  onStartEdit,
  onSimulateMatch,
  onSave,
  onCancelEdit,
  onClear,
  canClearMatch,
  canModifyMatch,
  actualResults = [],
  hidePredictedWhenLocked = false,
}: Props) {
  const knockout = matches.filter((m) => m.fixture.group == null);

  return (
    <div className="knockout-list">
      <h2 className="section-title">Fixtures</h2>
      <FixtureList
        matches={knockout}
        selectedMatchNumber={selectedMatchNumber}
        editingMatchNumber={editingMatchNumber}
        actualResults={actualResults}
        hidePredictedWhenLocked={hidePredictedWhenLocked}
        simulating={simulating}
        onSelect={onSelect}
        onStartEdit={onStartEdit}
        onSimulateMatch={onSimulateMatch}
        onSave={onSave}
        onCancelEdit={onCancelEdit}
        onClear={onClear}
        canClearMatch={canClearMatch}
        canModifyMatch={canModifyMatch}
      />
    </div>
  );
}
