const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const small = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 2 });

/** A rate for explanation text: whole numbers from 10 up, two significant digits below. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  return Math.abs(n) >= 10 || n === 0 ? whole.format(n) : small.format(n);
}

/** A fraction as a whole percentage, e.g. 0.456 → "46%". */
export function pct(n: number): string {
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "∞";
}

export function plural(n: number, word: string): string {
  return `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;
}
