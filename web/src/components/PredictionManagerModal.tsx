import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { PredictionListEntry, ValidateSelectionResult } from '../types.js';

const PAGE_SIZE = 50;

interface Props {
  activePredictionId: number | null;
  onClose: () => void;
  onSwitch: (id: number) => void;
  onCreate: (name: string, selection: string) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => Promise<void>;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'rename'; id: number; initialName: string }
  | { kind: 'delete'; id: number; name: string };

export function PredictionManagerModal({
  activePredictionId,
  onClose,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [selectedId, setSelectedId] = useState<number | null>(activePredictionId);
  const [nameInput, setNameInput] = useState('');
  const [selectionInput, setSelectionInput] = useState('');
  const [validation, setValidation] = useState<ValidateSelectionResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<PredictionListEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadPage = useCallback(async (nextPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listPredictions(nextPage, PAGE_SIZE);
      setPredictions(result.items);
      setTotal(result.total);
      setPage(result.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load predictions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  useEffect(() => {
    setSelectedId(activePredictionId);
  }, [activePredictionId]);

  useEffect(() => {
    if (mode.kind !== 'create') return;
    const trimmed = selectionInput.trim();
    if (!trimmed) {
      setValidation(null);
      setValidationError(null);
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await api.validateSelection(trimmed);
          setValidation(result);
          setValidationError(null);
        } catch (err) {
          setValidation(null);
          setValidationError(err instanceof Error ? err.message : 'Invalid selection');
        }
      })();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [mode.kind, selectionInput]);

  const handleSubmitCreate = () => {
    void (async () => {
      const name = nameInput.trim() || 'Prediction';
      const selection = selectionInput.trim();
      if (!selection) {
        setValidationError('Simulation range is required');
        return;
      }
      try {
        await onCreate(name, selection);
        setMode({ kind: 'list' });
        setNameInput('');
        setSelectionInput('');
        setValidation(null);
        setValidationError(null);
        await loadPage(1);
      } catch (err) {
        setValidationError(err instanceof Error ? err.message : 'Failed to create prediction');
      }
    })();
  };

  const handleSubmitName = () => {
    void (async () => {
      const name = nameInput.trim() || 'Prediction';
      const action = mode.kind;
      if (action === 'rename') await onRename(mode.id, name);
      setMode({ kind: 'list' });
      setNameInput('');
      if (action === 'rename') {
        await loadPage(page);
      }
    })();
  };

  const selectedPrediction = predictions.find((prediction) => prediction.id === selectedId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Predictions</h2>

        {mode.kind === 'list' && (
          <>
            <div className="sim-list">
              {loading ? (
                <p className="muted sim-list-status">Loading…</p>
              ) : error ? (
                <p className="modal-warning sim-list-status">{error}</p>
              ) : predictions.length === 0 ? (
                <p className="muted sim-list-status">No predictions — create one below.</p>
              ) : (
                predictions.map((prediction) => (
                  <div
                    key={prediction.id}
                    className={`sim-row ${prediction.id === selectedId ? 'selected' : ''} ${prediction.id === activePredictionId ? 'active' : ''}`}
                    onClick={() => setSelectedId(prediction.id)}
                    onDoubleClick={() => onSwitch(prediction.id)}
                  >
                    <span className="sim-id">#{prediction.id}</span>
                    <span className="sim-name">{prediction.name}</span>
                    <span className="sim-phase">{prediction.selectionLabel}</span>
                    <span className="sim-played">{prediction.simulationCount}</span>
                    {prediction.id === activePredictionId && <span className="sim-current">*</span>}
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
              <button
                type="button"
                className="btn"
                disabled={selectedId == null}
                onClick={() => selectedId != null && onSwitch(selectedId)}
              >
                Open
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setMode({ kind: 'create' });
                  setNameInput('');
                  setSelectionInput('');
                  setValidation(null);
                  setValidationError(null);
                }}
              >
                New
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!selectedPrediction}
                onClick={() => {
                  if (!selectedPrediction) return;
                  setMode({
                    kind: 'rename',
                    id: selectedPrediction.id,
                    initialName: selectedPrediction.name,
                  });
                  setNameInput(selectedPrediction.name);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!selectedPrediction}
                onClick={() => {
                  if (!selectedPrediction) return;
                  setMode({
                    kind: 'delete',
                    id: selectedPrediction.id,
                    name: selectedPrediction.name,
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

        {mode.kind === 'create' && (
          <>
            <label className="modal-label">New prediction name</label>
            <input
              className="modal-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              autoFocus
            />
            <label className="modal-label">Simulation range</label>
            <input
              className="modal-input"
              value={selectionInput}
              onChange={(e) => setSelectionInput(e.target.value)}
              placeholder="e.g. 1-100,105,200-300"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitCreate();
                if (e.key === 'Escape') setMode({ kind: 'list' });
              }}
            />
            <p className="muted modal-hint">
              Choose simulations by ID, like printer page ranges (1-100,105).
            </p>
            {validation && (
              <p className="muted modal-hint">
                {validation.count.toLocaleString()} simulation{validation.count === 1 ? '' : 's'}{' '}
                match
                {validation.minId != null && validation.maxId != null
                  ? ` (IDs ${validation.minId}–${validation.maxId})`
                  : ''}
              </p>
            )}
            {validationError && <p className="modal-warning">{validationError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={handleSubmitCreate}>
                Save
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setMode({ kind: 'list' })}>
                Cancel
              </button>
            </div>
          </>
        )}

        {mode.kind === 'rename' && (
          <>
            <label className="modal-label">Rename prediction</label>
            <input
              className="modal-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
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
            <p className="modal-warning">Delete prediction #{mode.id}?</p>
            <p>{mode.name}</p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  void (async () => {
                    await onDelete(mode.id);
                    setMode({ kind: 'list' });
                    const nextPage = predictions.length === 1 && page > 1 ? page - 1 : page;
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
