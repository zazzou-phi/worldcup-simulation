import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OutcomeDistribution, ResolvedMatch, ScorelineCount } from '../types.js';
import { matchTeamName } from '@shared/lib/matchDisplay.js';

const TOP_SCORELINES = 3;

interface Props {
  match: ResolvedMatch;
  distribution: OutcomeDistribution | undefined;
  onClose: () => void;
}

type MatchOutcome = 'homeWin' | 'draw' | 'awayWin';

function formatPct(count: number, total: number): string {
  if (total === 0) return '0%';
  return `${((count / total) * 100).toFixed(1)}%`;
}

function outcomeFromScoreline(s: Pick<ScorelineCount, 'goalsHome' | 'goalsAway'>): MatchOutcome {
  if (s.goalsHome > s.goalsAway) return 'homeWin';
  if (s.goalsAway > s.goalsHome) return 'awayWin';
  return 'draw';
}

function segmentColor(baseVar: string, index: number, segmentCount: number): string {
  if (segmentCount <= 1) return baseVar;
  const darken = 8 + (index * 36) / (segmentCount - 1);
  return `color-mix(in srgb, ${baseVar} ${100 - darken}%, black)`;
}

function sortScorelines(a: ScorelineCount, b: ScorelineCount): number {
  if (b.n !== a.n) return b.n - a.n;
  const totalA = a.goalsHome + a.goalsAway;
  const totalB = b.goalsHome + b.goalsAway;
  if (totalB !== totalA) return totalB - totalA;
  return b.goalsHome - a.goalsHome || b.goalsAway - a.goalsAway;
}

interface TooltipProps {
  label: string;
  count: number;
  outcomeTotal: number;
  allTotal: number;
  x: number;
  y: number;
}

function ScorelineTooltip({ label, count, outcomeTotal, allTotal, x, y }: TooltipProps) {
  return createPortal(
    <div
      className="master-bar-tooltip master-bar-tooltip-fixed"
      style={{ left: x, top: y }}
      role="tooltip"
    >
      <span className="master-bar-tooltip-label">{label}</span>
      <span className="master-bar-tooltip-stats">
        {count.toLocaleString()} · {formatPct(count, outcomeTotal)} of outcome ·{' '}
        {formatPct(count, allTotal)} overall
      </span>
    </div>,
    document.body,
  );
}

interface SegmentProps {
  label: string;
  count: number;
  outcomeTotal: number;
  allTotal: number;
  color: string;
}

function ScorelineSegment({ label, count, outcomeTotal, allTotal, color }: SegmentProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const showTooltip = () => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
  };

  return (
    <>
      <div
        ref={ref}
        className="master-bar-segment"
        style={{ flexGrow: count, backgroundColor: color }}
        role="img"
        aria-label={`${label}: ${count.toLocaleString()} (${formatPct(count, outcomeTotal)} of outcome, ${formatPct(count, allTotal)} overall)`}
        onMouseEnter={showTooltip}
        onMouseLeave={() => setTooltipPos(null)}
      />
      {tooltipPos && (
        <ScorelineTooltip
          label={label}
          count={count}
          outcomeTotal={outcomeTotal}
          allTotal={allTotal}
          x={tooltipPos.x}
          y={tooltipPos.y}
        />
      )}
    </>
  );
}

interface OutcomeBarProps {
  label: string;
  outcome: MatchOutcome;
  outcomeTotal: number;
  allTotal: number;
  scorelines: ScorelineCount[];
  baseColor: string;
}

function OutcomeBar({
  label,
  outcome,
  outcomeTotal,
  allTotal,
  scorelines,
  baseColor,
}: OutcomeBarProps) {
  const allMatching = scorelines
    .filter((s) => outcomeFromScoreline(s) === outcome)
    .sort(sortScorelines);
  const top = allMatching.slice(0, TOP_SCORELINES);
  const otherCount = allMatching.slice(TOP_SCORELINES).reduce((sum, s) => sum + s.n, 0);
  const segmentCount = top.length + (otherCount > 0 ? 1 : 0);

  if (outcomeTotal === 0 || segmentCount === 0) return null;

  return (
    <div className="master-outcome-bar">
      <div className="master-outcome-bar-header">
        <span className="master-outcome-bar-label">{label}</span>
        <span className="master-outcome-bar-summary">
          {outcomeTotal.toLocaleString()} ({formatPct(outcomeTotal, allTotal)})
        </span>
      </div>
      <div className="master-bar-stacked-track">
        {top.map((s, index) => (
          <ScorelineSegment
            key={`${s.goalsHome}-${s.goalsAway}`}
            label={`${s.goalsHome}–${s.goalsAway}`}
            count={s.n}
            outcomeTotal={outcomeTotal}
            allTotal={allTotal}
            color={segmentColor(baseColor, index, segmentCount)}
          />
        ))}
        {otherCount > 0 && (
          <ScorelineSegment
            key="other"
            label="Other"
            count={otherCount}
            outcomeTotal={outcomeTotal}
            allTotal={allTotal}
            color="var(--border)"
          />
        )}
      </div>
    </div>
  );
}

export function MasterFixtureModal({ match, distribution, onClose }: Props) {
  const homeName = matchTeamName(match, 'home');
  const awayName = matchTeamName(match, 'away');
  const played = match.result.status === 'played';
  const total = distribution?.total ?? 0;
  const scorelines = distribution?.scorelines ?? [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide master-fixture-modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          Match #{match.fixture.matchNumber} · {match.fixture.group}
        </h2>
        <p className="master-fixture-teams">
          {homeName} vs {awayName}
        </p>
        {played ? (
          <p className="master-fixture-consensus">
            Consensus: {match.result.goalsHome}–{match.result.goalsAway}
          </p>
        ) : (
          <p className="muted master-fixture-consensus">No consensus yet</p>
        )}

        {total > 0 && distribution ? (
          <div className="master-bar-chart">
            <OutcomeBar
              label={`${homeName} Win`}
              outcome="homeWin"
              outcomeTotal={distribution.homeWin}
              allTotal={total}
              scorelines={scorelines}
              baseColor="var(--green)"
            />
            <OutcomeBar
              label="Draw"
              outcome="draw"
              outcomeTotal={distribution.draw}
              allTotal={total}
              scorelines={scorelines}
              baseColor="var(--yellow)"
            />
            <OutcomeBar
              label={`${awayName} Win`}
              outcome="awayWin"
              outcomeTotal={distribution.awayWin}
              allTotal={total}
              scorelines={scorelines}
              baseColor="var(--accent)"
            />
            <p className="muted master-bar-total">
              Top {TOP_SCORELINES} scorelines plus other per outcome · {total.toLocaleString()}{' '}
              simulation{total === 1 ? '' : 's'} · hover a section for details
            </p>
          </div>
        ) : (
          <p className="muted">No simulation data for this fixture yet.</p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
