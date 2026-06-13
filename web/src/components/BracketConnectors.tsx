import type { LinearBracketDims } from '@shared/lib/bracket-linear.js';
import {
  buildConnectorSegments,
  canvasHeight,
  canvasWidth,
  computeBracketRows,
  connectorPath,
  WEB_LINEAR_DIMS,
} from '@shared/lib/bracket-linear.js';

interface Props {
  dims?: LinearBracketDims;
}

export function BracketConnectors({ dims = WEB_LINEAR_DIMS }: Props) {
  const rows = computeBracketRows();
  const width = canvasWidth(dims);
  const height = canvasHeight(rows, dims);
  const segments = buildConnectorSegments(rows, dims);

  return (
    <svg
      className="bracket-connectors"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      {segments.map((seg) => (
        <path
          key={`${seg.from}-${seg.to}-${seg.kind}`}
          d={connectorPath(seg)}
          className={seg.kind === 'loser' ? 'bracket-line bracket-line-loser' : 'bracket-line'}
        />
      ))}
    </svg>
  );
}
