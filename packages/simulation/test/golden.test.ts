// Golden tests: URL Shortener stage topologies give the expected statuses and success rates
// (prototype README "Results" table). Tolerance: ±0.5 percentage points on rates.

import { describe, expect, it } from "vitest";
import type { FailureScenario, NodeStatus } from "../src";
import { run } from "./run";
import {
  notificationPipeline,
  STAGE2,
  urlShortenerNoCache,
  urlShortenerWithCache,
  urlShortenerWithIdleReplica,
} from "./scenarios";

interface Golden {
  name: string;
  build: () => ReturnType<typeof urlShortenerNoCache>;
  rps: number;
  scenario?: FailureScenario;
  success: Record<string, number>;
  statuses: Record<string, NodeStatus>;
  breakingPointRps: number | null;
}

const GOLDEN: Golden[] = [
  {
    name: "stage 1, 110 rps, no cache",
    build: () => urlShortenerNoCache(2),
    rps: 110,
    success: { redirect: 1, create: 1 },
    statuses: { client: "ok", lb: "ok", api: "ok", db: "ok" },
    breakingPointRps: 2_000,
  },
  {
    name: "stage 2, no cache, 16 API instances",
    build: () => urlShortenerNoCache(16),
    rps: STAGE2.totalRps,
    success: { redirect: 0.5, create: 1 },
    statuses: { lb: "ok", api: "ok", db: "saturated" },
    breakingPointRps: 5_500,
  },
  {
    name: "stage 2, Redis cache-aside at 80% hits",
    build: () => urlShortenerWithCache(16, 0.8),
    rps: STAGE2.totalRps,
    success: { redirect: 1, create: 1 },
    statuses: { api: "ok", db: "ok", cache: "ok" },
    breakingPointRps: 16_000,
  },
  {
    name: "stage 3, primary DB down",
    build: () => urlShortenerWithCache(16, 0.8),
    rps: STAGE2.totalRps,
    scenario: { failures: [{ kind: "database-primary-down", nodeId: "db" }] },
    success: { redirect: 0.8, create: 0 },
    statuses: { db: "down", cache: "ok" },
    breakingPointRps: 16_000,
  },
  {
    name: "stage 3, primary DB down with an unused replica",
    build: () => urlShortenerWithIdleReplica(16),
    rps: STAGE2.totalRps,
    scenario: { failures: [{ kind: "database-primary-down", nodeId: "db" }] },
    success: { redirect: 0.8, create: 0 },
    statuses: { db: "down", replica: "idle" },
    breakingPointRps: 16_000,
  },
  {
    name: "stage 2, cache down",
    build: () => urlShortenerWithCache(16, 0.8),
    rps: STAGE2.totalRps,
    scenario: { failures: [{ kind: "cache-down", nodeId: "cache" }] },
    success: { redirect: 0.5, create: 1 },
    statuses: { cache: "down", db: "saturated" },
    breakingPointRps: 5_500,
  },
  {
    name: "async, worker down, 1,000 rps",
    build: () => notificationPipeline(10),
    rps: 1_000,
    scenario: { failures: [{ kind: "worker-down", nodeId: "worker" }] },
    success: { create: 1 },
    statuses: { api: "ok", queue: "ok", worker: "down", audit: "idle" },
    breakingPointRps: 2_000, // PostgreSQL writes; the down worker has no capacity to saturate
  },
];

describe("URL Shortener golden results", () => {
  it.each(GOLDEN.map((g) => [g.name, g] as const))("%s", (_name, g) => {
    const r = run(g.build(), { totalRps: g.rps }, g.scenario);
    for (const [op, expected] of Object.entries(g.success)) {
      expect(Math.abs(r.operations[op]!.processingSuccessRate - expected), `${op} success`).toBeLessThan(
        0.005,
      );
    }
    for (const [node, status] of Object.entries(g.statuses)) {
      expect(r.nodes[node]!.status, `${node} status`).toBe(status);
    }
    if (g.breakingPointRps === null) expect(r.capacity.breakingPointRps).toBeNull();
    else expect(r.capacity.breakingPointRps!).toBeCloseTo(g.breakingPointRps, 0);
  });
});
