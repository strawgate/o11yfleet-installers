import { useState, useEffect, useCallback, useRef } from "react";
import { clsx } from "clsx";

type ToastKind = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  title: string;
  body?: string;
  kind: ToastKind;
}

let nextId = 0;
const listeners = new Set<(t: Toast) => void>();

export function toast(title: string, body?: string, kind: ToastKind = "info") {
  const t: Toast = { id: nextId++, title, body, kind };
  for (const fn of listeners) fn(t);
}

const kindStyles: Record<ToastKind, string> = {
  success: "border-ok/30 bg-ok/5",
  error: "border-err/30 bg-err/5",
  warning: "border-warn/30 bg-warn/5",
  info: "border-info/30 bg-info/5",
};

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const addToast = useCallback((t: Toast) => {
    setToasts((prev) => [...prev, t]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== t.id));
      timers.current.delete(timer);
    }, 4000);
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    listeners.add(addToast);
    return () => {
      listeners.delete(addToast);
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
    };
  }, [addToast]);

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
      aria-live="polite"
      role="status"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            "rounded-lg border px-4 py-3 text-sm text-fg shadow-lg animate-in slide-in-from-right",
            kindStyles[t.kind],
          )}
        >
          <p className="font-medium">{t.title}</p>
          {t.body && <p className="mt-0.5 text-fg-3 text-xs">{t.body}</p>}
        </div>
      ))}
    </div>
  );
}
