// Performance budget (PRD §6): one simulation of a 150-node document < 5 ms, a 50-point sweep < 100 ms.
// Run with `pnpm --filter @sdl/simulation bench`. Budgets are checked against the mean latency.

import { describe, expect, test } from "vitest";
import { simulate, sweep } from "../src";
import { largeDesign } from "../test/large";

const design = largeDesign(150);
const traffic = { totalRps: 50_000 };
const failures = { failures: [{ kind: "database-primary-down" as const, nodeId: "db0" }] };

describe("150-node design", () => {
  test("simulate stays under 5 ms", async ({ bench }) => {
    const result = await bench("simulate", () => void simulate(design, traffic)).run();
    expect(result.latency.mean).toBeLessThan(5);
  });

  test("simulate with a failure stays under 5 ms", async ({ bench }) => {
    const result = await bench(
      "simulate with a failure",
      () => void simulate(design, traffic, failures),
    ).run();
    expect(result.latency.mean).toBeLessThan(5);
  });

  test("a 50-point sweep stays under 100 ms", async ({ bench }) => {
    const result = await bench(
      "sweep, 50 points",
      () => void sweep(design, traffic, undefined, { points: 50 }),
    ).run();
    expect(result.latency.mean).toBeLessThan(100);
  });
});
