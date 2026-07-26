import { useId, useRef } from 'react';
import ModalDialog from './ModalDialog.jsx';

function ConfirmDialog({
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  description,
  error,
  onCancel,
  onConfirm,
  open,
  showConfirm = true,
  title,
  tone = 'default',
  busy = false
}) {
  const headingId = useId();
  const cancelButtonRef = useRef(null);

  return (
    <ModalDialog
      ariaLabelledBy={headingId}
      dialogClassName="app-dialog-card app-confirm-dialog"
      initialFocusRef={cancelButtonRef}
      onClose={busy ? undefined : onCancel}
      open={open}
    >
      <div className="app-confirm-dialog-body">
        <div className="form-section-header form-section-header-stacked">
          <div className="form-section-header-top">
            <div>
              <h2 id={headingId}>{title}</h2>
            </div>
          </div>
        </div>
        {description ? <p className="app-confirm-dialog-text">{description}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        <div className="form-actions">
          {showConfirm ? (
            <button
              className={`button-link button-reset${tone === 'danger' ? ' archive-action' : ''}`}
              disabled={busy}
              type="button"
              onClick={onConfirm}
            >
              {busy ? 'Working...' : confirmLabel}
            </button>
          ) : null}
          <button
            className="button-link button-reset secondary-action"
            disabled={busy}
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}

export default ConfirmDialog;
