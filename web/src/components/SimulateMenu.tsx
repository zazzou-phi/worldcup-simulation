import { useEffect, useMemo, useRef, useState } from 'react';
import { getDisabledSimulateMenuKeys } from '@shared/engine/simulateMenuAvailability.js';
import { SIMULATION_KNOCKOUT_ROUNDS } from '@shared/engine/simulationRounds.js';
import type { TournamentState } from '../types.js';

const KNOCKOUT_ROUND_LABELS: Record<string, string> = {
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-final',
  semi_final: 'Semi-final',
  third_place: 'Third place',
  final: 'Final',
};

const GROUP_ITEMS = [
  { key: 'group:1', label: 'Round 1' },
  { key: 'group:2', label: 'Round 2' },
  { key: 'group:3', label: 'Round 3' },
] as const;

type MenuEntry =
  | { kind: 'item'; key: string; label: string; subtitle?: string; danger?: boolean }
  | { kind: 'divider' };

interface Props {
  state: TournamentState;
  simulating: boolean;
  publicMode?: boolean;
  simulationComplete?: boolean;
  onSimulateGroup: (games: 1 | 2 | 3) => void;
  onSimulateKnockouts: (throughRound: string) => void;
  onBulk: () => void;
  onClear?: () => void;
}

function buildItems(publicMode: boolean): MenuEntry[] {
  const knockoutItems: MenuEntry[] = SIMULATION_KNOCKOUT_ROUNDS.map((round) => ({
    kind: 'item',
    key: round.name,
    label: KNOCKOUT_ROUND_LABELS[round.name] ?? round.name,
  }));

  const items: MenuEntry[] = [
    ...GROUP_ITEMS.map((item) => ({ kind: 'item' as const, ...item })),
    ...knockoutItems,
  ];

  if (!publicMode) {
    items.push({ kind: 'divider' });
    items.push({ kind: 'item', key: 'bulk', label: 'Bulk' });
  }

  return items;
}

export function SimulateMenu({
  state,
  simulating,
  publicMode = false,
  simulationComplete = false,
  onSimulateGroup,
  onSimulateKnockouts,
  onBulk,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => {
    const base = buildItems(publicMode);
    if (!onClear) return base;
    return [
      ...base,
      { kind: 'divider' as const },
      { kind: 'item' as const, key: 'clear', label: 'Clear', danger: true },
    ];
  }, [publicMode, onClear]);
  const disabledKeys = useMemo(() => {
    const disabled = new Set(
      getDisabledSimulateMenuKeys({ fixtures: state.fixtures, matches: state.matches }),
    );
    if (simulationComplete) {
      for (const entry of items) {
        if (entry.kind === 'item' && entry.key !== 'bulk' && entry.key !== 'clear') {
          disabled.add(entry.key);
        }
      }
    }
    return disabled;
  }, [state.fixtures, state.matches, simulationComplete, items]);

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

  const handleSelect = (key: string) => {
    if (disabledKeys.has(key)) return;
    setOpen(false);
    if (key === 'clear') {
      onClear?.();
      return;
    }
    if (key === 'bulk') {
      onBulk();
      return;
    }
    if (key.startsWith('group:')) {
      onSimulateGroup(parseInt(key.slice('group:'.length), 10) as 1 | 2 | 3);
      return;
    }
    onSimulateKnockouts(key);
  };

  return (
    <div className={`simulate-menu ${open ? 'simulate-menu-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="btn btn-simulate"
        disabled={simulating}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {simulating ? 'Simulating…' : 'Simulate'}
      </button>
      {open && (
        <div className="simulate-menu-dropdown" role="menu">
          {items.map((entry, index) =>
            entry.kind === 'divider' ? (
              <div key={`divider-${index}`} className="header-menu-divider" role="separator" />
            ) : (
              <button
                key={entry.key}
                type="button"
                className={`simulate-menu-item${entry.danger ? ' simulate-menu-item-danger' : ''}`}
                role="menuitem"
                disabled={disabledKeys.has(entry.key)}
                onClick={() => handleSelect(entry.key)}
              >
                <span className="simulate-menu-item-label">{entry.label}</span>
                {entry.subtitle ? (
                  <span className="simulate-menu-item-sub">{entry.subtitle}</span>
                ) : null}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
