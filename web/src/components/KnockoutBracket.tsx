import { FINAL_MATCH_NUMBER, KNOCKOUT_ROUNDS } from '@shared/lib/bracket-layout.js';
import {
  canvasHeight,
  canvasWidth,
  columnLeft,
  computeBracketRows,
  matchNodeHeight,
  matchTop,
  roundColumnWidth,
  WEB_LINEAR_DIMS,
} from '@shared/lib/bracket-linear.js';
import { matchSideCode, matchWinnerSide } from '@shared/lib/matchDisplay.js';
import type { ResolvedMatch } from '../types.js';
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
}) {
  const played = match.result.status === 'played';
  const locked = match.isLocked;
  const editable = canEdit && !locked;
  const canSimulate = editable && !played && onSimulate != null;
  const pen =
    played &&
    match.result.goalsHome === match.result.goalsAway &&
    match.result.winnerTeamId != null;
  const num = match.fixture.matchNumber;

  return (
    <div
      className={`bracket-node ${large ? 'bracket-node-final' : ''} ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      onDoubleClick={() => editable && onStartEdit()}
    >
      <div className="bracket-node-num">#{num}</div>
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
          pen={pen}
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
}: Props) {
  const byNumber = new Map(matches.map((m) => [m.fixture.matchNumber, m]));
  const rows = computeBracketRows();
  const dims = WEB_LINEAR_DIMS;
  const width = canvasWidth(dims);
  const height = canvasHeight(rows, dims);

  return (
    <div className="knockout-bracket">
      <h2 className="section-title">Knockout Stage</h2>
      <div className="bracket-scroll">
        <div className="bracket-canvas" style={{ width, height }}>
          <BracketConnectors />
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
                      canEdit
                      onSelect={() => onSelect(num === selectedMatchNumber ? null : num)}
                      onStartEdit={() => onStartEdit(num)}
                      onSimulate={
                        onSimulateMatch ? () => onSimulateMatch(num) : undefined
                      }
                      onSave={(h, a, w) => onSave(num, h, a, w)}
                      onCancelEdit={onCancelEdit}
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
}: Props) {
  const knockout = matches.filter((m) => m.fixture.group == null);

  return (
    <div className="knockout-list">
      <h2 className="section-title">Knockout Stage</h2>
      <FixtureList
        matches={knockout}
        selectedMatchNumber={selectedMatchNumber}
        editingMatchNumber={editingMatchNumber}
        simulating={simulating}
        onSelect={onSelect}
        onStartEdit={onStartEdit}
        onSimulateMatch={onSimulateMatch}
        onSave={onSave}
        onCancelEdit={onCancelEdit}
        onClear={onClear}
      />
    </div>
  );
}
