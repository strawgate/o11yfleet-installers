import { createContext, useContext, useCallback, useState, useRef, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type ToastKind = "default" | "err";

interface ToastItem {
  id: number;
  title: string;
  body?: string;
  kind: ToastKind;
  fading: boolean;
}

interface ToastContextValue {
  toast: (title: string, body?: string, kind?: ToastKind) => void;
}

/* ------------------------------------------------------------------ */
/*  Context                                                           */
/* ------------------------------------------------------------------ */

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Provider                                                          */
/* ------------------------------------------------------------------ */

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const toast = useCallback((title: string, body?: string, kind: ToastKind = "default") => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, title, body, kind, fading: false }]);

    // Start fade-out after 3.2s
    const fadeTimer = setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, fading: true } : t)));
      // Remove after fade animation
      const removeTimer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timersRef.current.delete(id);
      }, 220);
      timersRef.current.set(id, removeTimer);
    }, 3200);

    timersRef.current.set(id, fadeTimer);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toaster">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast${t.kind === "err" ? " err" : ""}`}
            style={
              t.fading
                ? { opacity: 0, transform: "translateY(8px)", transition: "all 220ms" }
                : undefined
            }
          >
            {t.kind === "err" ? (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3.5M8 11v.01" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <div>
              <div className="t-title">{t.title}</div>
              {t.body && <div className="t-body">{t.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
