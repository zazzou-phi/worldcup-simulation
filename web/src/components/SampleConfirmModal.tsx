interface Props {
  onConfirm: () => void;
  onClose: () => void;
}

export function SampleConfirmModal({ onConfirm, onClose }: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Resample prediction scores?</h2>
        <p className="modal-warning">
          This replaces every sampled fixture score with a new random sample from the pool. Locked
          actual results are not affected.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            Resample
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
