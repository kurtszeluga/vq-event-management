import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

function ModalDialog({
  ariaLabel,
  ariaLabelledBy,
  backdropClassName = 'app-dialog-backdrop',
  bodyClassName = 'app-dialog-open',
  children,
  closeOnBackdrop = true,
  dialogClassName = 'app-dialog-card',
  initialFocusRef,
  onClose,
  open
}) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    document.body.classList.add(bodyClassName);

    const focusable = dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || [];
    const initialFocus = initialFocusRef?.current || focusable[0] || dialogRef.current;
    initialFocus?.focus();

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const nextFocusable = dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR);

      if (!nextFocusable?.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = nextFocusable[0];
      const last = nextFocusable[nextFocusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove(bodyClassName);
      previousFocusRef.current?.focus?.();
    };
  }, [bodyClassName, initialFocusRef, open]);

  if (!open) {
    return null;
  }

  return (
    <div className={backdropClassName}>
      {closeOnBackdrop ? (
        <button
          aria-hidden="true"
          className="app-dialog-backdrop-button"
          tabIndex={-1}
          type="button"
          onClick={onClose}
        />
      ) : (
        <div aria-hidden="true" className="app-dialog-backdrop-button" />
      )}
      <div
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-modal="true"
        className={dialogClassName}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

export default ModalDialog;
