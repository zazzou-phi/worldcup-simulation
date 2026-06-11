import { BRACKET_FEEDS, type BracketFeedKind } from './bracket-feeds.js';
import {
  FINAL_MATCH_NUMBER,
  KNOCKOUT_ROUNDS,
  THIRD_PLACE_MATCH_NUMBER,
  roundIndexForMatch,
} from './bracket-layout.js';

export { BRACKET_FEEDS };

export const BRACKET_MAX_ROW = 15;

export interface LinearBracketDims {
  colWidth: number;
  colGap: number;
  rowUnit: number;
  nodeHeight: number;
  headerHeight: number;
  padding: number;
  /** Extra width for the final column and match node. */
  finalColWidthExtra: number;
  /** Extra height for the final match node. */
  finalNodeHeightExtra: number;
  /** Shift connector Y to align with rendered node center (terminal cells). */
  connectorYInset?: number;
}

export const WEB_LINEAR_DIMS: LinearBracketDims = {
  colWidth: 152,
  colGap: 32,
  rowUnit: 88,
  nodeHeight: 76,
  headerHeight: 28,
  padding: 16,
  finalColWidthExtra: 40,
  finalNodeHeightExtra: 40,
};

export const TUI_LINEAR_DIMS: LinearBracketDims = {
  colWidth: 12,
  colGap: 4,
  rowUnit: 8,
  nodeHeight: 6,
  headerHeight: 1,
  padding: 0,
  finalColWidthExtra: 8,
  finalNodeHeightExtra: 4,
  connectorYInset: -0.5,
};

export function computeBracketRows(): ReadonlyMap<number, number> {
  const rows = new Map<number, number>();
  KNOCKOUT_ROUNDS[0].matches.forEach((m, i) => rows.set(m, i));

  for (let ri = 1; ri < KNOCKOUT_ROUNDS.length; ri++) {
    for (const m of KNOCKOUT_ROUNDS[ri].matches) {
      if (m === THIRD_PLACE_MATCH_NUMBER) {
        rows.set(m, (rows.get(101)! + rows.get(102)!) / 2);
        continue;
      }
      const feeders = BRACKET_FEEDS.filter((f) => f.to === m && f.kind === 'winner').map(
        (f) => f.from,
      );
      if (feeders.length === 2) {
        rows.set(m, (rows.get(feeders[0])! + rows.get(feeders[1])!) / 2);
      }
    }
  }

  return rows;
}

export function roundColumnWidth(roundIndex: number, dims: LinearBracketDims): number {
  const finalRi = roundIndexForMatch(FINAL_MATCH_NUMBER);
  return roundIndex === finalRi ? dims.colWidth + dims.finalColWidthExtra : dims.colWidth;
}

export function matchNodeHeight(matchNumber: number, dims: LinearBracketDims): number {
  if (matchNumber === FINAL_MATCH_NUMBER) {
    return dims.nodeHeight + dims.finalNodeHeightExtra;
  }
  return dims.nodeHeight;
}

export function columnLeft(roundIndex: number, dims: LinearBracketDims): number {
  let x = dims.padding;
  for (let i = 0; i < roundIndex; i++) {
    x += roundColumnWidth(i, dims) + dims.colGap;
  }
  return x;
}

export function columnRight(roundIndex: number, dims: LinearBracketDims): number {
  return columnLeft(roundIndex, dims) + roundColumnWidth(roundIndex, dims);
}

export function matchNodeWidth(matchNumber: number, dims: LinearBracketDims): number {
  return roundColumnWidth(roundIndexForMatch(matchNumber), dims);
}

export function matchCenterY(
  matchNumber: number,
  rows: ReadonlyMap<number, number>,
  dims: LinearBracketDims,
): number {
  const row = rows.get(matchNumber)!;
  return dims.headerHeight + row * dims.rowUnit + dims.nodeHeight / 2;
}

export function matchTop(
  matchNumber: number,
  rows: ReadonlyMap<number, number>,
  dims: LinearBracketDims,
): number {
  return matchCenterY(matchNumber, rows, dims) - matchNodeHeight(matchNumber, dims) / 2;
}

export function canvasWidth(dims: LinearBracketDims): number {
  const colWidths = KNOCKOUT_ROUNDS.reduce((s, _, i) => s + roundColumnWidth(i, dims), 0);
  return dims.padding * 2 + colWidths + dims.colGap * (KNOCKOUT_ROUNDS.length - 1);
}

export function canvasHeight(rows: ReadonlyMap<number, number>, dims: LinearBracketDims): number {
  const maxRow = Math.max(...rows.values());
  const finalExtra = dims.finalNodeHeightExtra / 2;
  return dims.padding * 2 + dims.headerHeight + maxRow * dims.rowUnit + dims.nodeHeight + finalExtra;
}

export function visibleColumnCount(viewportWidth: number, dims: LinearBracketDims): number {
  let count = 0;
  let x = dims.padding;
  for (let i = 0; i < KNOCKOUT_ROUNDS.length; i++) {
    const w = roundColumnWidth(i, dims);
    if (count > 0 && x + w > viewportWidth) break;
    count++;
    x += w + dims.colGap;
  }
  return Math.max(1, count);
}

export function maxColumnOffset(viewportWidth: number, dims: LinearBracketDims): number {
  return Math.max(0, KNOCKOUT_ROUNDS.length - visibleColumnCount(viewportWidth, dims));
}

export function maxRowOffset(viewportHeight: number, rows: ReadonlyMap<number, number>, dims: LinearBracketDims): number {
  const contentH = canvasHeight(rows, dims);
  return Math.max(0, contentH - viewportHeight);
}

export interface MatchAnchor {
  left: number;
  right: number;
  centerX: number;
  centerY: number;
}

export function connectorCenterY(
  matchNumber: number,
  rows: ReadonlyMap<number, number>,
  dims: LinearBracketDims,
): number {
  return (
    matchTop(matchNumber, rows, dims) +
    matchNodeHeight(matchNumber, dims) / 2 +
    (dims.connectorYInset ?? 0)
  );
}

export function getMatchAnchor(
  matchNumber: number,
  rows: ReadonlyMap<number, number>,
  dims: LinearBracketDims,
): MatchAnchor {
  const ri = roundIndexForMatch(matchNumber);
  const left = columnLeft(ri, dims);
  const width = matchNodeWidth(matchNumber, dims);
  return {
    left,
    right: left + width,
    centerX: left + width / 2,
    centerY: connectorCenterY(matchNumber, rows, dims),
  };
}

export interface ConnectorSegment {
  from: number;
  to: number;
  kind: BracketFeedKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function buildConnectorSegments(
  rows: ReadonlyMap<number, number>,
  dims: LinearBracketDims,
): ConnectorSegment[] {
  return BRACKET_FEEDS.map((feed) => {
    const from = getMatchAnchor(feed.from, rows, dims);
    const to = getMatchAnchor(feed.to, rows, dims);
    const fromCol = roundIndexForMatch(feed.from);
    const toCol = roundIndexForMatch(feed.to);

    let x1: number;
    let x2: number;
    if (feed.kind === 'loser' && feed.to === THIRD_PLACE_MATCH_NUMBER) {
      x1 = from.centerX;
      x2 = to.centerX;
    } else if (fromCol < toCol) {
      x1 = from.right;
      x2 = to.left;
    } else if (fromCol > toCol) {
      x1 = from.left;
      x2 = to.right;
    } else {
      x1 = from.centerX;
      x2 = to.centerX;
    }

    return {
      from: feed.from,
      to: feed.to,
      kind: feed.kind,
      x1,
      y1: from.centerY,
      x2,
      y2: to.centerY,
    };
  });
}

export function connectorPath(seg: ConnectorSegment): string {
  if (seg.kind === 'loser' && seg.to === THIRD_PLACE_MATCH_NUMBER) {
    return `M ${seg.x1} ${seg.y1} V ${seg.y2}`;
  }
  return elbowPath(seg.x1, seg.y1, seg.x2, seg.y2);
}

export function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
}
