import { useEffect, useRef, useState } from 'react';
import { SIMULATION_KNOCKOUT_ROUNDS } from '@shared/engine/simulationRounds.js';

const KNOCKOUT_ROUND_LABELS: Record<string, string> = {
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-final',
  semi_final: 'Semi-final',
  third_place: 'Third place',
  final: 'Final',
};

const GROUP_ITEMS = [
  { key: '1' as const, label: 'G1', subtitle: 'through MD07' },
  { key: '2' as const, label: 'G2', subtitle: 'through MD13' },
  { key: '3' as const, label: 'G3', subtitle: 'through MD17' },
];

interface SimulateMenuProps {
  label: string;
  simulating: boolean;
  items: Array<{ key: string; label: string; subtitle?: string }>;
  onSelect: (key: string) => void;
}

function SimulateMenu({ label, simulating, items, onSelect }: SimulateMenuProps) {
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

  const handleSelect = (key: string) => {
    setOpen(false);
    onSelect(key);
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
        {simulating ? 'Simulating…' : label}
      </button>
      {open && (
        <div className="simulate-menu-dropdown" role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="simulate-menu-item"
              role="menuitem"
              onClick={() => handleSelect(item.key)}
            >
              <span className="simulate-menu-item-label">{item.label}</span>
              {item.subtitle ? (
                <span className="simulate-menu-item-sub">{item.subtitle}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface GroupSimulateMenuProps {
  simulating: boolean;
  onSelect: (games: 1 | 2 | 3) => void;
}

export function GroupSimulateMenu({ simulating, onSelect }: GroupSimulateMenuProps) {
  return (
    <SimulateMenu
      label="Simulate Group"
      simulating={simulating}
      items={GROUP_ITEMS}
      onSelect={(key) => onSelect(parseInt(key, 10) as 1 | 2 | 3)}
    />
  );
}

interface KnockoutSimulateMenuProps {
  simulating: boolean;
  onSelect: (throughRound: string) => void;
}

export function KnockoutSimulateMenu({ simulating, onSelect }: KnockoutSimulateMenuProps) {
  const items = SIMULATION_KNOCKOUT_ROUNDS.map((round) => ({
    key: round.name,
    label: KNOCKOUT_ROUND_LABELS[round.name] ?? round.name,
  }));

  return (
    <SimulateMenu
      label="Simulate Knockouts"
      simulating={simulating}
      items={items}
      onSelect={onSelect}
    />
  );
}
