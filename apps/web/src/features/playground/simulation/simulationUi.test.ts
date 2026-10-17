import type { Operation } from "@sdl/architecture";
import { createEmptyDocument } from "@sdl/architecture";
import {
  DEFAULT_TRAFFIC,
  formatPct,
  formatRate,
  formatRateShort,
  mixForReadShare,
  readShare,
  trafficOf,
} from "./simulationUi";

const OPS: Operation[] = [
  { id: "get", name: "Get", kind: "read", share: 6 },
  { id: "list", name: "List", kind: "read", share: 3 },
  { id: "put", name: "Put", kind: "write", share: 1 },
  { id: "notify", name: "Notify", kind: "write", share: 0 },
];

describe("simulation UI helpers", () => {
  it("derives the read share from operation shares or the mix override", () => {
    expect(readShare(OPS, { totalRps: 1 })).toBeCloseTo(0.9);
    expect(readShare(OPS, { totalRps: 1, mix: { get: 1, list: 0, put: 1 } })).toBeCloseTo(0.5);
    expect(readShare([{ ...OPS[3]! }], { totalRps: 1 })).toBeNull();
  });

  it("builds a mix for a target read share that keeps relative shares within reads and writes", () => {
    const mix = mixForReadShare(OPS, 0.6)!;
    expect(mix.get! / mix.list!).toBeCloseTo(2);
    expect(mix.get! + mix.list!).toBeCloseTo(0.6);
    expect(mix.put).toBeCloseTo(0.4);
    expect(mix.notify).toBeUndefined();
    expect(readShare(OPS, { totalRps: 1, mix })).toBeCloseTo(0.6);
    // Already the natural ratio, or no writes to trade against: no override.
    expect(mixForReadShare(OPS, 0.9)).toBeUndefined();
    expect(mixForReadShare(OPS.slice(0, 2), 0.5)).toBeUndefined();
  });

  it("formats rates and percentages for display", () => {
    expect(formatRate(1234.4)).toBe("1,234");
    expect(formatRate(0.55)).toBe("0.6");
    expect(formatRate(Infinity)).toBe("∞");
    expect(formatRateShort(11_000)).toBe("11K/s");
    expect(formatRateShort(2.5)).toBe("2.5/s");
    expect(formatPct(0.5)).toBe("50%");
    expect(formatPct(0.996)).toBe("99.6%");
    expect(formatPct(0.004)).toBe("<1%");
    expect(formatPct(2)).toBe("200%");
    expect(formatPct(Infinity)).toBe("∞");
  });

  it("uses the saved traffic or a default", () => {
    const doc = createEmptyDocument();
    expect(trafficOf(doc)).toBe(DEFAULT_TRAFFIC);
    expect(trafficOf({ ...doc, traffic: { totalRps: 5 } })).toEqual({ totalRps: 5 });
  });
});
