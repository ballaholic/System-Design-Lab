import { COMPONENT_TYPES } from "@sdl/architecture";
import { describe, expect, it } from "vitest";
import { describeFailure, FAILURE_KINDS, FAILURES, failuresFor, normalizeScenario, simulate } from "../src";
import { run } from "./run";
import { notificationPipeline, STAGE2, urlShortenerWithCache } from "./scenarios";

describe("failure registry", () => {
  it("offers each failure only for the component types it applies to", () => {
    expect(failuresFor("sql-database").map((f) => f.kind)).toEqual(["database-primary-down"]);
    expect(failuresFor("object-storage").map((f) => f.kind)).toEqual(["database-primary-down"]);
    expect(failuresFor("redis-cache").map((f) => f.kind)).toEqual(["cache-down"]);
    expect(failuresFor("api-server").map((f) => f.kind)).toEqual(["app-instance-failure"]);
    expect(failuresFor("background-worker").map((f) => f.kind)).toEqual(["worker-down"]);
    expect(failuresFor("load-balancer")).toEqual([]);
  });

  it("only refers to real component types", () => {
    for (const kind of FAILURE_KINDS) {
      expect(FAILURES[kind].kind).toBe(kind);
      for (const type of FAILURES[kind].appliesTo) expect(COMPONENT_TYPES).toContain(type);
    }
  });

  it("describes failures for people", () => {
    const d = urlShortenerWithCache(4);
    const api = d.nodes.find((n) => n.id === "api");
    expect(describeFailure({ kind: "app-instance-failure", nodeId: "api", count: 2 }, api)).toBe(
      '"API Server": 2 instances failed',
    );
    expect(describeFailure({ kind: "app-instance-failure", nodeId: "api", count: 1 }, api)).toBe(
      '"API Server": 1 instance failed',
    );
    expect(describeFailure({ kind: "cache-down", nodeId: "x" }, undefined)).toBe(
      "A removed component is down",
    );
  });
});

describe("normalizeScenario", () => {
  const d = urlShortenerWithCache(4);

  it("ignores failures on missing or unsuitable components, with a warning", () => {
    const { failures, issues } = normalizeScenario(d, {
      failures: [
        { kind: "cache-down", nodeId: "gone" },
        { kind: "worker-down", nodeId: "db" },
        { kind: "cache-down", nodeId: "cache" },
      ],
    });
    expect(failures).toEqual([{ kind: "cache-down", nodeId: "cache" }]);
    expect(issues.map((i) => [i.code, i.severity])).toEqual([
      ["FAILURE_NOT_APPLICABLE", "warning"],
      ["FAILURE_NOT_APPLICABLE", "warning"],
    ]);
    expect(issues[1]!.nodeIds).toEqual(["db"]);
  });

  it("adds up instance failures on the same server and drops duplicates of the others", () => {
    const { failures } = normalizeScenario(d, {
      failures: [
        { kind: "app-instance-failure", nodeId: "api", count: 1 },
        { kind: "app-instance-failure", nodeId: "api", count: 2.7 },
        { kind: "app-instance-failure", nodeId: "api", count: Number.NaN },
        { kind: "database-primary-down", nodeId: "db" },
        { kind: "database-primary-down", nodeId: "db" },
      ],
    });
    expect(failures).toEqual([
      { kind: "app-instance-failure", nodeId: "api", count: 4 },
      { kind: "database-primary-down", nodeId: "db" },
    ]);
  });

  it("treats a missing scenario as no failures", () => {
    expect(normalizeScenario(d, undefined)).toEqual({ failures: [], issues: [] });
  });
});

describe("combined failures", () => {
  it("applies several failures at once", () => {
    const r = run(urlShortenerWithCache(16, 0.8), STAGE2, {
      failures: [
        { kind: "cache-down", nodeId: "cache" },
        { kind: "database-primary-down", nodeId: "db" },
      ],
    });
    expect(r.operations.redirect!.processingSuccessRate).toBe(0);
    expect(r.operations.create!.processingSuccessRate).toBe(0);
  });

  it("still simulates when a failure no longer applies, and says so", () => {
    const r = simulate(
      notificationPipeline(2),
      { totalRps: 100 },
      {
        failures: [{ kind: "worker-down", nodeId: "removed" }],
      },
    );
    expect(r.status).toBe("ok");
    expect(r.issues.map((i) => i.code)).toContain("FAILURE_NOT_APPLICABLE");
  });
});
