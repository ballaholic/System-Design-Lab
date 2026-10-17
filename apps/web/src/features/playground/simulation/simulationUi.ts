import type { ArchitectureDocument, Operation, TrafficProfile } from "@sdl/architecture";
import { type NodeStatus, type Resource, STATUS_DESCRIPTIONS } from "@sdl/simulation";
import { CircleCheck, CircleDashed, CircleOff, Flame, Gauge, type LucideIcon } from "lucide-react";

export const DEFAULT_TRAFFIC: TrafficProfile = { totalRps: 1000 };

export function trafficOf(doc: ArchitectureDocument): TrafficProfile {
  return doc.traffic ?? DEFAULT_TRAFFIC;
}

/** Colour, icon and text for each status: never colour alone (accessibility). */
export const STATUS_UI: Record<
  NodeStatus,
  { label: string; description: string; icon: LucideIcon; text: string; border: string }
> = {
  ok: { ...STATUS_DESCRIPTIONS.ok, icon: CircleCheck, text: "text-success", border: "border-success/70" },
  warm: { ...STATUS_DESCRIPTIONS.warm, icon: Gauge, text: "text-warning", border: "border-warning" },
  saturated: {
    ...STATUS_DESCRIPTIONS.saturated,
    icon: Flame,
    text: "text-destructive",
    border: "border-destructive",
  },
  down: {
    ...STATUS_DESCRIPTIONS.down,
    icon: CircleOff,
    text: "text-destructive",
    border: "border-destructive border-dashed",
  },
  idle: {
    ...STATUS_DESCRIPTIONS.idle,
    icon: CircleDashed,
    text: "text-muted-foreground",
    border: "border-border",
  },
};

export const RESOURCE_LABEL: Record<Resource, string> = { total: "", read: "reads", write: "writes" };

const rateFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const compactRate = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** A rate per second for tables: "1,234" or "0.5". */
export function formatRate(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  return rateFormat.format(n >= 100 ? Math.round(n) : n);
}

/** Short rate for canvas labels: "1.2K/s". */
export function formatRateShort(n: number): string {
  return `${compactRate.format(n >= 10 ? Math.round(n) : n)}/s`;
}

/** Whole percentages, with one decimal near the ends so 99.6% doesn't read as 100%. */
export function formatPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return "∞";
  const p = ratio * 100;
  if (p > 0 && p < 1) return "<1%";
  if (p > 99 && p < 100) return `${(Math.floor(p * 10) / 10).toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

/** Share of client traffic that is reads, from the operation shares or the traffic mix override. */
export function readShare(operations: Operation[], traffic: TrafficProfile): number | null {
  let reads = 0;
  let total = 0;
  for (const o of operations) {
    const share = traffic.mix?.[o.id] ?? o.share;
    total += share;
    if (o.kind === "read") reads += share;
  }
  return total > 0 ? reads / total : null;
}

/**
 * A mix that gives reads `ratio` of the traffic, keeping the relative shares of the operations within reads and
 * within writes. Returns undefined when the operation shares already give that ratio.
 */
export function mixForReadShare(operations: Operation[], ratio: number): Record<string, number> | undefined {
  const sent = operations.filter((o) => o.share > 0);
  const readTotal = sent.filter((o) => o.kind === "read").reduce((a, o) => a + o.share, 0);
  const writeTotal = sent.filter((o) => o.kind === "write").reduce((a, o) => a + o.share, 0);
  if (readTotal === 0 || writeTotal === 0) return undefined;
  const natural = readTotal / (readTotal + writeTotal);
  if (Math.abs(natural - ratio) < 0.0005) return undefined;
  return Object.fromEntries(
    sent.map((o) => [
      o.id,
      Math.round(
        (o.kind === "read" ? (ratio * o.share) / readTotal : ((1 - ratio) * o.share) / writeTotal) * 1e6,
      ) / 1e6,
    ]),
  );
}
