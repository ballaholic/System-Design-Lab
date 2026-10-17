import { createEmptyDocument } from "@sdl/architecture";
import { describe, expect, it } from "vitest";
import { canonicalJson, ENGINE_VERSION, hash64, simulate, simulationInputHash, sweep } from "../src";
import { largeDesign } from "./large";
import { run } from "./run";
import { STAGE2, urlShortenerNoCache, urlShortenerWithCache } from "./scenarios";

describe("sweep", () => {
  it("defaults to 50 points up to twice the breaking point and matches single runs", () => {
    const d = urlShortenerNoCache(16);
    const s = sweep(d, STAGE2);
    if (s.status !== "ok") throw new Error("invalid");
    expect(s.breakingPointRps).toBeCloseTo(5_500);
    expect(s.points).toHaveLength(50);
    expect(s.points[0]!.rps).toBeCloseTo(220);
    expect(s.points.at(-1)!.rps).toBeCloseTo(11_000);

    for (const point of [s.points[9]!, s.points[30]!, s.points[49]!]) {
      const single = run(d, { totalRps: point.rps });
      expect(point.processingSuccessRate).toBeCloseTo(single.summary.processingSuccessRate);
      expect(point.operations.redirect).toBeCloseTo(single.operations.redirect!.processingSuccessRate);
    }
  });

  it("reports the first saturated resource once load passes the breaking point", () => {
    const s = sweep(urlShortenerNoCache(16), STAGE2, undefined, { points: 4, maxRps: 8_000 });
    if (s.status !== "ok") throw new Error("invalid");
    expect(s.points.map((p) => p.rps)).toEqual([2_000, 4_000, 6_000, 8_000]);
    expect(s.points[0]!.firstSaturated).toBeUndefined();
    expect(s.points[2]!.firstSaturated).toEqual({ nodeId: "db", resource: "read" });
    expect(s.points[3]!.processingSuccessRate).toBeLessThan(s.points[1]!.processingSuccessRate);
  });

  it("falls back to twice the current RPS when nothing saturates and clamps the number of points", () => {
    const d = urlShortenerWithCache(16);
    for (const n of d.nodes) n.config = { ...n.config } as never;
    const free = createEmptyDocument();
    const s = sweep(d, { totalRps: 1_000 }, undefined, { points: 1 });
    expect(s.points).toHaveLength(2);
    const many = sweep(d, { totalRps: 1_000 }, undefined, { points: 10_000 });
    expect(many.points).toHaveLength(200);
    // An empty document has no clients, so nothing is constrained.
    const empty = sweep(free, { totalRps: 1_000 });
    expect(empty.status).toBe("ok");
    if (empty.status === "ok") {
      expect(empty.breakingPointRps).toBeNull();
      expect(empty.points.at(-1)!.rps).toBeCloseTo(2_000);
      expect(empty.points[0]!.processingSuccessRate).toBe(1);
    }
  });

  it("returns no points for an invalid document or traffic", () => {
    const d = urlShortenerNoCache(2);
    d.edges.push({ id: "db->client", source: "db", target: "client" });
    expect(sweep(d, STAGE2)).toMatchObject({ status: "invalid", points: [] });
    expect(sweep(urlShortenerNoCache(2), { totalRps: 0 })).toMatchObject({ status: "invalid", points: [] });
  });
});

describe("invalid input", () => {
  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, 20_000_000])("rejects total RPS %s", (totalRps) => {
    const r = simulate(urlShortenerNoCache(2), { totalRps });
    expect(r.status).toBe("invalid");
    expect(r.issues.map((i) => i.code)).toEqual(["TRAFFIC_INVALID"]);
  });

  it("rejects a negative share in the traffic mix", () => {
    const r = simulate(urlShortenerNoCache(2), { totalRps: 10, mix: { redirect: -1 } });
    expect(r.issues.map((i) => i.message)).toEqual(["Operation shares can't be negative."]);
  });

  it("returns only issues, the engine version and assumptions when invalid", () => {
    const r = simulate(createEmptyDocument(), { totalRps: 0 });
    expect(Object.keys(r).sort()).toEqual(["assumptions", "engineVersion", "inputHash", "issues", "status"]);
    expect(r.engineVersion).toBe(ENGINE_VERSION);
  });
});

describe("input hash", () => {
  it("ignores layout, notes and saved traffic but not anything that changes the result", () => {
    const d = urlShortenerWithCache(16);
    const base = simulationInputHash(d, STAGE2);
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(simulationInputHash({ ...d, layout: {}, notes: "hi", traffic: { totalRps: 1 } }, STAGE2)).toBe(
      base,
    );
    expect(simulationInputHash(d, { totalRps: 11_001 })).not.toBe(base);
    expect(simulationInputHash(d, STAGE2, { failures: [{ kind: "cache-down", nodeId: "cache" }] })).not.toBe(
      base,
    );
    expect(
      simulationInputHash({ ...d, nodes: d.nodes.map((n) => ({ ...n, label: `${n.label}!` })) }, STAGE2),
    ).not.toBe(base);
    expect(run(d, STAGE2).inputHash).toBe(base);
  });

  it("serializes canonically regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: [1, undefined, { d: null, c: "x" }], u: undefined })).toBe(
      '{"a":[1,null,{"c":"x","d":null}],"b":1}',
    );
    expect(canonicalJson(undefined)).toBe("null");
    expect(hash64("")).toHaveLength(16);
    expect(hash64("a")).not.toBe(hash64("b"));
  });
});

describe("large designs", () => {
  it("simulates a 150-node design deterministically", () => {
    const d = largeDesign(150);
    expect(d.nodes).toHaveLength(150);
    const a = run(d, { totalRps: 50_000 });
    const b = run(structuredClone(d), { totalRps: 50_000 });
    expect(a).toEqual(b);
    expect(a.summary.processingSuccessRate).toBeGreaterThan(0.99);
  });
});
