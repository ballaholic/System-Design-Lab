import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ASSUMPTIONS,
  capabilitySummary,
  MENTOR_MAX_EVENTS,
  ROLE_SEMANTICS,
  toMentorSimulation,
} from "../src";
import {
  CAPABILITIES_PATH,
  SAMPLE_CONTEXT_PATH,
  sampleScenario,
  serializeCapabilities,
  serializeSampleContext,
} from "./mentorFiles";
import { run } from "./run";
import { STAGE2, urlShortenerNoCache } from "./scenarios";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

describe("mentor simulation context", () => {
  it("keeps the engine's numbers, rounded, with the failures and assumptions", () => {
    const { scenario, result } = sampleScenario();
    const context = toMentorSimulation(result, STAGE2, scenario);
    expect(context).toMatchObject({
      engineVersion: result.engineVersion,
      inputHash: result.inputHash,
      traffic: STAGE2,
      failures: [{ kind: "database-primary-down", nodeId: "db" }],
      assumptions: result.assumptions,
    });
    expect(context.nodes.db).toMatchObject({ status: "down" });
    expect(context.nodes.db).not.toHaveProperty("utilization");
    expect(context.nodes.cache!.effectiveHitRate).toBe(0.8);
    expect(context.operations.redirect!.processingSuccessRate).toBeCloseTo(
      result.operations.redirect!.processingSuccessRate,
      3,
    );
    expect(String(context.summary.processingSuccessRate).replace(/^0\./, "").length).toBeLessThanOrEqual(4);
  });

  it("reports saturation, the breaking point and at most the first events", () => {
    const result = run(urlShortenerNoCache(2), STAGE2);
    const context = toMentorSimulation(result, STAGE2, { failures: [] });
    expect(context.nodes.api!.status).toBe("saturated");
    expect(context.nodes.api!.utilization).toBeGreaterThan(1);
    expect(context.capacity.breakingPointRps).toBe(result.capacity.breakingPointRps);
    expect(context.capacity.firstSaturation).toEqual(result.capacity.firstSaturation);
    expect(context.events.length).toBeLessThanOrEqual(MENTOR_MAX_EVENTS);
    expect(context.summary.bottlenecks[0]).toMatchObject({ nodeId: expect.any(String) });
  });
});

describe("capability summary", () => {
  it("lists every assumption and every component's unmodeled behaviour", () => {
    const summary = capabilitySummary();
    for (const a of ASSUMPTIONS) expect(summary).toContain(a.id);
    for (const role of ROLE_SEMANTICS) for (const item of role.notModeled) expect(summary).toContain(item);
    expect(summary).toContain("Latency, percentiles and queueing delay");
  });
});

describe("generated files (run `pnpm --filter @sdl/simulation mentor-files` when stale)", () => {
  it("schemas/simulator-capabilities.md is up to date", () => {
    expect(read(CAPABILITIES_PATH)).toBe(serializeCapabilities());
  });

  it("schemas/fixtures/mentor/simulation-context.json is up to date", () => {
    expect(read(SAMPLE_CONTEXT_PATH)).toBe(serializeSampleContext());
  });
});
