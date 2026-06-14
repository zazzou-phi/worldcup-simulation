import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ConsensusMode } from '../lib/consensusMode.js';
import {
  CONSENSUS_MODE_HINT,
  CONSENSUS_MODE_OPTIONS,
  formatConsensusMode,
} from '../lib/consensusMode.js';
import type { OutcomeDistribution, ResolvedMatch, ScorelineCount } from '../types.js';
import { matchTeamName } from '@shared/lib/matchDisplay.js';

const TOP_SCORELINES = 3;
const TOOLTIP_MARGIN = 8;
const TOOLTIP_GAP = 6;

interface TooltipAnchor {
  x: number;
  y: number;
  bottom: number;
}

function clampTooltipPosition(
  anchor: TooltipAnchor,
  width: number,
  height: number,
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = anchor.y - height - TOOLTIP_GAP;
  if (top < TOOLTIP_MARGIN) {
    top = anchor.bottom + TOOLTIP_GAP;
  }
  top = Math.max(TOOLTIP_MARGIN, Math.min(top, vh - TOOLTIP_MARGIN - height));

  let left = anchor.x - width / 2;
  left = Math.max(TOOLTIP_MARGIN, Math.min(left, vw - TOOLTIP_MARGIN - width));

  return { left, top };
}

interface Props {
  match: ResolvedMatch;
  distribution: OutcomeDistribution | undefined;
  defaultConsensusMode: ConsensusMode;
  canEditFrozenConsensus?: boolean;
  savingFrozenConsensus?: boolean;
  onFrozenConsensusModeChange?: (matchNumber: number, mode: ConsensusMode) => void;
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
  anchor: TooltipAnchor;
}

function ScorelineTooltip({ label, count, outcomeTotal, allTotal, anchor }: TooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const { left, top } = clampTooltipPosition(anchor, width, height);
    setStyle({ left, top, visibility: 'visible' });
  }, [anchor, label, count, outcomeTotal, allTotal]);

  return createPortal(
    <div
      ref={ref}
      className="master-bar-tooltip master-bar-tooltip-fixed"
      style={style}
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
  const [tooltipAnchor, setTooltipAnchor] = useState<TooltipAnchor | null>(null);

  const showTooltip = () => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTooltipAnchor({
      x: rect.left + rect.width / 2,
      y: rect.top,
      bottom: rect.bottom,
    });
  };

  const hideTooltip = () => setTooltipAnchor(null);

  return (
    <>
      <div
        ref={ref}
        className="master-bar-segment"
        style={{ flexGrow: count, backgroundColor: color }}
        role="img"
        aria-label={`${label}: ${count.toLocaleString()} (${formatPct(count, outcomeTotal)} of outcome, ${formatPct(count, allTotal)} overall)`}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onTouchStart={(e) => {
          e.stopPropagation();
          showTooltip();
        }}
      />
      {tooltipAnchor && (
        <ScorelineTooltip
          label={label}
          count={count}
          outcomeTotal={outcomeTotal}
          allTotal={allTotal}
          anchor={tooltipAnchor}
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

export function MasterFixtureModal({
  match,
  distribution,
  defaultConsensusMode,
  canEditFrozenConsensus = false,
  savingFrozenConsensus = false,
  onFrozenConsensusModeChange,
  onClose,
}: Props) {
  const homeName = matchTeamName(match, 'home');
  const awayName = matchTeamName(match, 'away');
  const played = match.result.status === 'played';
  const total = distribution?.total ?? 0;
  const scorelines = distribution?.scorelines ?? [];
  const frozenConsensusMode = distribution?.consensusMode ?? defaultConsensusMode;
  const showFrozenConsensusControl =
    match.isLocked && canEditFrozenConsensus && total > 0 && onFrozenConsensusModeChange != null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide master-fixture-modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          Match #{match.fixture.matchNumber} · {match.fixture.group}
          {match.isLocked ? ' 🔒' : ''}
        </h2>
        <p className="master-fixture-teams">
          {homeName} vs {awayName}
        </p>
        {played ? (
          <p className="master-fixture-consensus">
            Consensus: {match.result.goalsHome}–{match.result.goalsAway}
            {match.isLocked && distribution?.consensusMode ? (
              <span className="master-fixture-consensus-mode-label">
                {' '}
                · {formatConsensusMode(frozenConsensusMode)}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="muted master-fixture-consensus">No consensus yet</p>
        )}

        {showFrozenConsensusControl && (
          <div className="master-fixture-consensus-mode" title={CONSENSUS_MODE_HINT}>
            <span className="master-fixture-consensus-mode-title">Locked consensus strategy</span>
            <div className="master-fixture-consensus-mode-buttons">
              {CONSENSUS_MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`btn btn-small btn-ghost ${
                    frozenConsensusMode === option.value ? 'active' : ''
                  }`}
                  title={CONSENSUS_MODE_HINT}
                  disabled={savingFrozenConsensus || frozenConsensusMode === option.value}
                  onClick={() =>
                    onFrozenConsensusModeChange!(match.fixture.matchNumber, option.value)
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
            {savingFrozenConsensus && (
              <span className="muted master-fixture-consensus-mode-saving">Updating…</span>
            )}
          </div>
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
              simulation{total === 1 ? '' : 's'} · hover or tap a section for details
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
