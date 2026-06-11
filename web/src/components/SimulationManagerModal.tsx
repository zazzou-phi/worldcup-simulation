import { useState } from 'react';
import { phaseLabel } from '@shared/engine/phase.js';
import type { SimulationListEntry } from '../types.js';

interface Props {
  simulations: SimulationListEntry[];
  activeSimulationId: number;
  onClose: () => void;
  onSwitch: (id: number) => void;
  onCreate: (name: string) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'rename'; id: number; initialName: string }
  | { kind: 'delete'; id: number; name: string };

export function SimulationManagerModal({
  simulations,
  activeSimulationId,
  onClose,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [selectedId, setSelectedId] = useState(activeSimulationId);
  const [inputValue, setInputValue] = useState('');

  const handleSubmitName = () => {
    const name = inputValue.trim() || 'Simulation';
    if (mode.kind === 'create') onCreate(name);
    else if (mode.kind === 'rename') onRename(mode.id, name);
    setMode({ kind: 'list' });
    setInputValue('');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Simulations</h2>

        {mode.kind === 'list' && (
          <>
            <div className="sim-list">
              {simulations.length === 0 ? (
                <p className="muted">No simulations — create one below.</p>
              ) : (
                simulations.map((sim) => (
                  <div
                    key={sim.id}
                    className={`sim-row ${sim.id === selectedId ? 'selected' : ''} ${sim.id === activeSimulationId ? 'active' : ''}`}
                    onClick={() => setSelectedId(sim.id)}
                    onDoubleClick={() => onSwitch(sim.id)}
                  >
                    <span className="sim-id">#{sim.id}</span>
                    <span className="sim-name">{sim.name}</span>
                    <span className="sim-phase">{phaseLabel(sim.phase)}</span>
                    <span className="sim-played">{sim.playedCount}/104</span>
                    {sim.id === activeSimulationId && <span className="sim-current">*</span>}
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => onSwitch(selectedId)}>
                Open
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setMode({ kind: 'create' });
                  setInputValue('');
                }}
              >
                New
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  const sim = simulations.find((s) => s.id === selectedId);
                  if (sim) {
                    setMode({ kind: 'rename', id: sim.id, initialName: sim.name });
                    setInputValue(sim.name);
                  }
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const sim = simulations.find((s) => s.id === selectedId);
                  if (sim) setMode({ kind: 'delete', id: sim.id, name: sim.name });
                }}
              >
                Delete
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {(mode.kind === 'create' || mode.kind === 'rename') && (
          <>
            <label className="modal-label">
              {mode.kind === 'create' ? 'New simulation name' : 'Rename simulation'}
            </label>
            <input
              className="modal-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitName();
                if (e.key === 'Escape') setMode({ kind: 'list' });
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={handleSubmitName}>
                Save
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setMode({ kind: 'list' })}>
                Cancel
              </button>
            </div>
          </>
        )}

        {mode.kind === 'delete' && (
          <>
            <p className="modal-warning">
              Delete simulation #{mode.id}?
            </p>
            <p>{mode.name}</p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  onDelete(mode.id);
                  setMode({ kind: 'list' });
                }}
              >
                Confirm delete
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setMode({ kind: 'list' })}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
