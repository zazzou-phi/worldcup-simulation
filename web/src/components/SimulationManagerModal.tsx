import { useCallback, useEffect, useState } from 'react';
import { phaseLabel } from '@shared/engine/phase.js';
import { api } from '../api/client.js';
import type { SimulationListEntry } from '../types.js';

const PAGE_SIZE = 50;

interface Props {
  activeSimulationId: number;
  onClose: () => void;
  onSwitch: (id: number) => void;
  onCreate: (name: string) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => Promise<void>;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'rename'; id: number; initialName: string }
  | { kind: 'delete'; id: number; name: string };

export function SimulationManagerModal({
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
  const [simulations, setSimulations] = useState<SimulationListEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadPage = useCallback(async (nextPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listSimulations(nextPage, PAGE_SIZE);
      setSimulations(result.items);
      setTotal(result.total);
      setPage(result.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load simulations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  useEffect(() => {
    setSelectedId(activeSimulationId);
  }, [activeSimulationId]);

  const handleSubmitName = () => {
    void (async () => {
      const name = inputValue.trim() || 'Simulation';
      const action = mode.kind;
      if (action === 'create') await onCreate(name);
      else if (action === 'rename') await onRename(mode.id, name);
      setMode({ kind: 'list' });
      setInputValue('');
      if (action === 'rename') {
        await loadPage(page);
      }
    })();
  };

  const selectedSimulation = simulations.find((sim) => sim.id === selectedId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Simulations</h2>

        {mode.kind === 'list' && (
          <>
            <div className="sim-list">
              {loading ? (
                <p className="muted sim-list-status">Loading…</p>
              ) : error ? (
                <p className="modal-warning sim-list-status">{error}</p>
              ) : simulations.length === 0 ? (
                <p className="muted sim-list-status">No simulations — create one below.</p>
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
            {total > PAGE_SIZE && (
              <div className="sim-pagination">
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  disabled={loading || page <= 1}
                  onClick={() => void loadPage(page - 1)}
                >
                  Previous
                </button>
                <span className="sim-pagination-meta muted">
                  Page {page} of {totalPages} ({total.toLocaleString()} total)
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  disabled={loading || page >= totalPages}
                  onClick={() => void loadPage(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
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
                disabled={!selectedSimulation}
                onClick={() => {
                  if (!selectedSimulation) return;
                  setMode({
                    kind: 'rename',
                    id: selectedSimulation.id,
                    initialName: selectedSimulation.name,
                  });
                  setInputValue(selectedSimulation.name);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!selectedSimulation}
                onClick={() => {
                  if (!selectedSimulation) return;
                  setMode({
                    kind: 'delete',
                    id: selectedSimulation.id,
                    name: selectedSimulation.name,
                  });
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
                  void (async () => {
                    await onDelete(mode.id);
                    setMode({ kind: 'list' });
                    const nextPage =
                      simulations.length === 1 && page > 1 ? page - 1 : page;
                    await loadPage(nextPage);
                  })();
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
