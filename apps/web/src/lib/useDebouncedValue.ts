import { useEffect, useState } from "react";

/** The value, updated only after it has stopped changing for `delayMs`. A delay of 0 follows it immediately. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delayMs === 0) return;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return delayMs === 0 ? value : debounced;
}
