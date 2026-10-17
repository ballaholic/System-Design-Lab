import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/**
 * Eases from the previously shown value to `target` (starting from `from` on first render). Returns the
 * target straight away when motion is reduced or animation frames aren't available.
 */
export function useAnimatedNumber(target: number, { from = 0, durationMs = 600 } = {}): number {
  const reducedMotion = usePrefersReducedMotion();
  const canAnimate = !reducedMotion && typeof requestAnimationFrame === "function";
  const [shown, setShown] = useState(canAnimate ? from : target);
  const shownRef = useRef(shown);

  useEffect(() => {
    if (!canAnimate) return;
    const start = shownRef.current;
    const began = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - began) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      const value = start + (target - start) * eased;
      shownRef.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, canAnimate]);

  return canAnimate ? shown : target;
}
