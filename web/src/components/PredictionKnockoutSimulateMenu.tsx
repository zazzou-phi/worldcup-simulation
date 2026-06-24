import { useEffect, useRef, useState } from 'react';
import type { KnockoutRoundAvailability } from '../types.js';

interface Props {
  rounds: KnockoutRoundAvailability[];
  groupStageComplete: boolean;
  simulating: boolean;
  hasKnockoutResults: boolean;
  onSimulateRound: (roundName: string) => void;
  onOpenBulk?: () => void;
  onClearKnockout?: () => void;
}

export function PredictionKnockoutSimulateMenu({
  rounds,
  groupStageComplete,
  simulating,
  hasKnockoutResults,
  onSimulateRound,
  onOpenBulk,
  onClearKnockout,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSelect = (round: KnockoutRoundAvailability) => {
    if (!round.canSimulate) return;
    setOpen(false);
    onSimulateRound(round.name);
  };

  return (
    <div className={`simulate-menu ${open ? 'simulate-menu-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="btn btn-simulate"
        disabled={simulating || !groupStageComplete}
        title={
          groupStageComplete
            ? 'Simulate a knockout round using consensus'
            : 'Complete the group stage before simulating knockouts'
        }
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {simulating ? 'Simulating…' : 'Simulate'}
      </button>
      {open && (
        <div className="simulate-menu-dropdown" role="menu">
          {rounds.map((round) => (
            <button
              key={round.name}
              type="button"
              className="simulate-menu-item"
              role="menuitem"
              disabled={!round.canSimulate}
              title={round.disabledReason}
              onClick={() => handleSelect(round)}
            >
              <span className="simulate-menu-item-label">
                {round.label}
                {round.isComplete ? ' ✓' : ''}
              </span>
              {!round.canSimulate && round.disabledReason ? (
                <span className="simulate-menu-item-sub">{round.disabledReason}</span>
              ) : null}
            </button>
          ))}
          {onOpenBulk && (
            <>
              <div className="header-menu-divider" role="separator" />
              <button
                type="button"
                className="simulate-menu-item"
                role="menuitem"
                disabled={!groupStageComplete}
                title={
                  groupStageComplete
                    ? 'Simulate one round with custom parameters'
                    : 'Complete the group stage before simulating knockouts'
                }
                onClick={() => {
                  setOpen(false);
                  onOpenBulk();
                }}
              >
                <span className="simulate-menu-item-label">Simulate round…</span>
              </button>
            </>
          )}
          {onClearKnockout && hasKnockoutResults && (
            <>
              <div className="header-menu-divider" role="separator" />
              <button
                type="button"
                className="simulate-menu-item simulate-menu-item-danger"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onClearKnockout();
                }}
              >
                <span className="simulate-menu-item-label">Clear knockout</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
