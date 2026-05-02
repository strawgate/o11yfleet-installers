import { useCallback, useEffect, useState } from "react";
import type {
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  VisibilityState,
} from "@tanstack/react-table";
import type { PersistedTableState } from "../types";

const STORAGE_PREFIX = "fb-dt:";

/**
 * Sync column sizing / order / visibility / pinning to localStorage so
 * users keep their column tweaks across sessions. Pass `undefined` for
 * persistKey to disable persistence (in-memory only).
 */
export function usePersistedTableState(
  persistKey: string | undefined,
  initial: PersistedTableState = {},
) {
  const storageKey = persistKey ? `${STORAGE_PREFIX}${persistKey}` : undefined;

  const [state, setState] = useState<PersistedTableState>(() => {
    if (!storageKey) return initial;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return initial;
      return { ...initial, ...(JSON.parse(raw) as PersistedTableState) };
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // localStorage full or unavailable — ignore
    }
  }, [storageKey, state]);

  const setSizing = useCallback(
    (updater: ColumnSizingState | ((prev: ColumnSizingState) => ColumnSizingState)) => {
      setState((prev) => ({
        ...prev,
        columnSizing: typeof updater === "function" ? updater(prev.columnSizing ?? {}) : updater,
      }));
    },
    [],
  );

  const setOrder = useCallback(
    (updater: ColumnOrderState | ((prev: ColumnOrderState) => ColumnOrderState)) => {
      setState((prev) => ({
        ...prev,
        columnOrder: typeof updater === "function" ? updater(prev.columnOrder ?? []) : updater,
      }));
    },
    [],
  );

  const setVisibility = useCallback(
    (updater: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => {
      setState((prev) => ({
        ...prev,
        columnVisibility:
          typeof updater === "function" ? updater(prev.columnVisibility ?? {}) : updater,
      }));
    },
    [],
  );

  const setPinning = useCallback(
    (updater: ColumnPinningState | ((prev: ColumnPinningState) => ColumnPinningState)) => {
      setState((prev) => ({
        ...prev,
        columnPinning:
          typeof updater === "function"
            ? updater(prev.columnPinning ?? { left: [], right: [] })
            : updater,
      }));
    },
    [],
  );

  return {
    state,
    setSizing,
    setOrder,
    setVisibility,
    setPinning,
  };
}
