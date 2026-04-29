import { useEffect, useCallback, useId, useRef, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && modalRef.current) {
        const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", handleKeyDown);
    // Focus first focusable element
    requestAnimationFrame(() => {
      if (modalRef.current) {
        const first = modalRef.current.querySelector<HTMLElement>(FOCUSABLE);
        first?.focus();
      }
    });
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, handleKeyDown]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <div className={`modal-backdrop${open ? " open" : ""}`} onClick={handleBackdropClick}>
      <div
        className="modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <h3 id={titleId}>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              width="14"
              height="14"
            >
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
