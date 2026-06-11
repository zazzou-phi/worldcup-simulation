import {
  buildConnectorSegments,
  canvasHeight,
  canvasWidth,
  computeBracketRows,
  connectorPath,
  WEB_LINEAR_DIMS,
} from '@shared/lib/bracket-linear.js';

export function BracketConnectors() {
  const rows = computeBracketRows();
  const dims = WEB_LINEAR_DIMS;
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
