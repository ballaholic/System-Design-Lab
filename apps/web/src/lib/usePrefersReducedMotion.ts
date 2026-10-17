import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = typeof window !== "undefined" ? window.matchMedia?.(QUERY) : undefined;
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

const getSnapshot = () => (typeof window !== "undefined" && window.matchMedia?.(QUERY).matches) || false;

/** Whether the person asked the system for less motion. For animations CSS can't switch off (SVG motion). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
