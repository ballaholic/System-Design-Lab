import { useState } from "react";

/**
 * Local editable state that is re-derived whenever `source` changes (for example after undo). Uses React's
 * "adjust state during render" pattern instead of an effect, so there's no extra render with stale text.
 * `derive` receives the current local value, so it can keep an edit that already means the same thing.
 */
export function useSyncedState<S, T = S>(source: S, derive?: (source: S, current: T | undefined) => T) {
  const compute = (s: S, current: T | undefined) => (derive ? derive(s, current) : (s as unknown as T));
  const [value, setValue] = useState<T>(() => compute(source, undefined));
  const [previous, setPrevious] = useState(source);
  if (!Object.is(source, previous)) {
    setPrevious(source);
    setValue(compute(source, value));
  }
  return [value, setValue] as const;
}
