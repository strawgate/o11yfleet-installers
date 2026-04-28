import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="backdrop:bg-black/60 bg-transparent p-0 m-0 fixed inset-0 flex items-center justify-center w-full h-full"
    >
      <div className="bg-surface border border-line rounded-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          <button
            onClick={onClose}
            className="text-fg-4 hover:text-fg transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
