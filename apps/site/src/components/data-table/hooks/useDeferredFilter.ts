import { useDeferredValue, useEffect, useState } from "react";

/**
 * Debounce a filter input by deferring updates until the user pauses typing.
 * React 19's `useDeferredValue` is a free deferred update; we additionally
 * gate by a stable-time threshold so server-mode tables don't refire on
 * every keystroke.
 */
export function useDeferredFilter<T>(immediate: T, delayMs = 250): T {
  const deferred = useDeferredValue(immediate);
  const [stable, setStable] = useState<T>(deferred);

  useEffect(() => {
    const t = setTimeout(() => setStable(deferred), delayMs);
    return () => clearTimeout(t);
  }, [deferred, delayMs]);

  return stable;
}
