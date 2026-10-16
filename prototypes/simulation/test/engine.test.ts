import { describe, expect, it } from "vitest";
import { simulate } from "../src/engine.js";
import type { ArchitectureDocument } from "../src/model.js";
import {
  notificationPipeline,
  urlShortenerNoCache,
  urlShortenerWithCache,
  urlShortenerWithIdleReplica,
} from "../src/scenarios.js";

// Stage traffic: 11,000 rps at 10:1 ⇒ 10,000 redirects/s and 1,000 creates/s.
const STAGE2 = { totalRps: 11_000 };

describe("request-flow routing", () => {
  it("sends redirects to the database only on cache misses and never looks up the cache for creates", () => {
    const r = simulate(urlShortenerWithCache(16, 0.8), STAGE2);

    expect(r.status).toBe("ok");
    const db = r.nodes.db!;
    expect(db.resources.read!.offered).toBeCloseTo(2_000); // 20% of 10,000 redirects
    expect(db.resources.write!.offered).toBeCloseTo(1_000); // every create
    expect(db.byOperation.redirect!.offered).toBeCloseTo(2_000);
    expect(db.byOperation.create!.offered).toBeCloseTo(1_000);

    const cache = r.nodes.cache!.cache!;
    expect(cache.lookups).toBeCloseTo(10_000); // redirects only
    expect(cache.hits).toBeCloseTo(8_000);
    expect(cache.misses).toBeCloseTo(2_000);
    expect(cache.otherOps).toBeCloseTo(1_000); // create invalidations
    expect(cache.populateOffered).toBeCloseTo(2_000); // one populate per miss
    expect(r.nodes.cache!.byOperation.create!.offered).toBeCloseTo(1_000);
  });

  it("routes each operation only to services that have a flow for it", () => {
    const doc: ArchitectureDocument = {
      schemaVersion: 1,
      operations: [
        { id: "redirect", name: "Redirect", kind: "read", share: 10 },
        { id: "create", name: "Create", kind: "write", share: 1 },
      ],
      nodes: [
        { id: "client", type: "web-client", label: "Browser", config: {} },
        { id: "lb", type: "load-balancer", label: "LB", config: {} },
        { id: "read-api", type: "api-server", label: "Read API", config: { instances: 20 }, flows: { redirect: [{ type: "call", edge: "r->db" }] } },
        { id: "write-api", type: "api-server", label: "Write API", config: { instances: 2 }, flows: { create: [{ type: "call", edge: "w->db" }] } },
        { id: "db", type: "sql-database", label: "DB", config: { readCapacity: 20_000 } },
      ],
      edges: [
        { id: "c->lb", source: "client", target: "lb" },
        { id: "lb->r", source: "lb", target: "read-api" },
        { id: "lb->w", source: "lb", target: "write-api" },
        { id: "r->db", source: "read-api", target: "db" },
        { id: "w->db", source: "write-api", target: "db" },
      ],
    };
    const r = simulate(doc, STAGE2);

    expect(r.nodes["read-api"]!.byOperation).toEqual({ redirect: { offered: 10_000, admitted: 10_000 } });
    expect(r.nodes["write-api"]!.byOperation).toEqual({ create: { offered: 1_000, admitted: 1_000 } });
    expect(r.edges["lb->r"]).toBeCloseTo(10_000);
    expect(r.edges["lb->w"]).toBeCloseTo(1_000);
    expect(r.summary.processingSuccessRate).toBeCloseTo(1);
  });

  it("splits traffic evenly across capable targets of a load balancer", () => {
    const doc = urlShortenerNoCache(10);
    doc.nodes.push({ ...(doc.nodes.find((n) => n.id === "api") as Extract<(typeof doc.nodes)[number], { type: "api-server" }>), id: "api2", label: "API Server 2", flows: { redirect: [{ type: "call", edge: "api2->db" }], create: [{ type: "call", edge: "api2->db" }] } });
    doc.edges.push({ id: "lb->api2", source: "lb", target: "api2" }, { id: "api2->db", source: "api2", target: "db" });

    const r = simulate(doc, { totalRps: 1_100 });
    expect(r.edges["lb->api"]).toBeCloseTo(550);
    expect(r.edges["lb->api2"]).toBeCloseTo(550);
  });
});

describe("URL Shortener lessons", () => {
  it("stage 1: a single database comfortably handles ~100 rps", () => {
    const r = simulate(urlShortenerNoCache(2), { totalRps: 110 });
    expect(r.summary.processingSuccessRate).toBeCloseTo(1);
    expect(r.nodes.db!.status).toBe("ok");
    expect(r.summary.bottlenecks).toEqual([]);
  });

  it("stage 2 without a cache: database reads saturate, about half of redirects fail, writes stay healthy", () => {
    const r = simulate(urlShortenerNoCache(16), STAGE2);

    expect(r.nodes.db!.status).toBe("saturated");
    expect(r.nodes.db!.resources.read!.utilization).toBeCloseTo(2); // 10,000 / 5,000
    expect(r.nodes.db!.resources.write!.utilization).toBeCloseTo(0.5); // 1,000 / 2,000
    expect(r.operations.redirect!.processingSuccessRate).toBeCloseTo(0.5);
    expect(r.operations.create!.processingSuccessRate).toBeCloseTo(1);
    expect(r.summary.processingSuccessRate).toBeCloseTo(6_000 / 11_000);
    expect(r.summary.bottlenecks[0]).toMatchObject({ nodeId: "db", resource: "read" });
    expect(r.events.some((e) => e.kind === "saturated" && e.nodeIds.includes("db"))).toBe(true);
  });

  it("stage 2 with Redis at 80% hit rate: every request succeeds", () => {
    const r = simulate(urlShortenerWithCache(16, 0.8), STAGE2);

    expect(r.summary.processingSuccessRate).toBeCloseTo(1);
    expect(r.nodes.db!.resources.read!.utilization).toBeCloseTo(0.4);
    expect(r.nodes.db!.status).toBe("ok");
    expect(r.events.filter((e) => e.kind === "saturated")).toEqual([]);
  });

  it("stage 3 primary database down: redirects succeed at the hit rate, creates fail", () => {
    const r = simulate(urlShortenerWithCache(16, 0.8), STAGE2, {
      failures: [{ kind: "database-primary-down", nodeId: "db" }],
    });

    expect(r.nodes.db!.status).toBe("down");
    expect(r.operations.redirect!.processingSuccessRate).toBeCloseTo(0.8);
    expect(r.operations.create!.processingSuccessRate).toBeCloseTo(0);
    // Requests were still accepted at the entry point; they failed during processing.
    expect(r.operations.create!.accepted).toBeCloseTo(1_000);
  });

  it("stage 3 with an unused second database: reports failover as not modeled instead of inventing it", () => {
    const r = simulate(urlShortenerWithIdleReplica(16), STAGE2, {
      failures: [{ kind: "database-primary-down", nodeId: "db" }],
    });

    expect(r.issues).toContainEqual(expect.objectContaining({ code: "UNUSED_CONNECTION", edgeIds: ["api->replica"] }));
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "unmodeled", nodeIds: ["db", "replica"] }));
    expect(r.operations.create!.processingSuccessRate).toBeCloseTo(0);
    expect(r.nodes.replica!.status).toBe("idle");
  });
});

describe("caching semantics", () => {
  it("cache down: every lookup misses, reads fall through to the database, optional invalidation is reported", () => {
    const r = simulate(urlShortenerWithCache(16, 0.8), STAGE2, { failures: [{ kind: "cache-down", nodeId: "cache" }] });

    expect(r.nodes.cache!.cache!.effectiveHitRate).toBe(0);
    expect(r.nodes.db!.resources.read!.offered).toBeCloseTo(10_000);
    expect(r.operations.redirect!.processingSuccessRate).toBeCloseTo(0.5);
    expect(r.operations.create!.processingSuccessRate).toBeCloseTo(1); // invalidation is optional
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "unmodeled", nodeIds: ["api", "cache"] }));
  });

  it("cache fills (populate) use only leftover capacity and never affect lookups or success", () => {
    const doc = urlShortenerWithCache(16, 0.8);
    const cache = doc.nodes.find((n) => n.id === "cache")!;
    if (cache.type === "redis-cache") cache.config.capacityOps = 12_000;

    const r = simulate(doc, STAGE2);
    const c = r.nodes.cache!;
    // Lookups (10,000) + invalidations (1,000) = 11,000 fit; 2,000 fills compete for the remaining 1,000.
    expect(c.cache!.effectiveHitRate).toBeCloseTo(0.8);
    expect(c.cache!.populateOffered).toBeCloseTo(2_000);
    expect(c.cache!.populateAdmitted).toBeCloseTo(1_000);
    expect(c.resources.total).toMatchObject({ capacity: 12_000 });
    expect(c.resources.total!.offered).toBeCloseTo(13_000);
    expect(c.resources.total!.admitted).toBeCloseTo(12_000);
    expect(c.resources.total!.rejected).toBeCloseTo(1_000); // only fills were dropped
    expect(r.nodes.db!.resources.read!.offered).toBeCloseTo(2_000);
    expect(r.summary.processingSuccessRate).toBeCloseTo(1);
  });

  it("without populate, misses add no cache load", () => {
    const doc = urlShortenerWithCache(16, 0.8);
    const api = doc.nodes.find((n) => n.id === "api");
    if (api?.type === "api-server") {
      const lookup = api.flows!.redirect![0]!;
      if (lookup.type === "cache-lookup") lookup.populate = false;
    }
    const r = simulate(doc, STAGE2);
    expect(r.nodes.cache!.cache!.populateOffered).toBe(0);
    expect(r.nodes.cache!.resources.total!.offered).toBeCloseTo(11_000);
  });

  it("an overloaded cache treats rejected lookups as misses", () => {
    const doc = urlShortenerWithCache(16, 0.8);
    const cache = doc.nodes.find((n) => n.id === "cache")!;
    if (cache.type === "redis-cache") cache.config.capacityOps = 5_000;

    const r = simulate(doc, STAGE2);
    const a = 5_000 / 11_000; // 10,000 lookups + 1,000 invalidations offered
    expect(r.nodes.cache!.cache!.effectiveHitRate).toBeCloseTo(0.8 * a);
    expect(r.nodes.db!.resources.read!.offered).toBeCloseTo(10_000 * (1 - 0.8 * a));
    expect(r.nodes.cache!.cache!.populateAdmitted).toBe(0); // no leftover capacity
    // Hits succeed; of the misses, the database serves exactly its 5,000 read capacity.
    expect(r.operations.redirect!.processingSuccessRate).toBeCloseTo(0.8 * a + 5_000 / 10_000);
  });
});

describe("overload and instance failures", () => {
  it("sheds load above capacity and propagates only admitted load downstream", () => {
    const doc = urlShortenerWithCache(16, 0.8);
    const lb = doc.nodes.find((n) => n.id === "lb")!;
    if (lb.type === "load-balancer") lb.config.capacityRps = 5_000;

    const r = simulate(doc, STAGE2);
    expect(r.nodes.lb!.resources.total!.rejected).toBeCloseTo(6_000);
    expect(r.nodes.api!.resources.total!.offered).toBeCloseTo(5_000);
    expect(r.operations.redirect!.accepted).toBeCloseTo(10_000 * (5_000 / 11_000));
    expect(r.summary.processingSuccessRate).toBeCloseTo(5_000 / 11_000);
  });

  it("app instance failure reduces capacity", () => {
    const r = simulate(urlShortenerWithCache(16, 0.8), STAGE2, {
      failures: [{ kind: "app-instance-failure", nodeId: "api", count: 6 }],
    });
    expect(r.nodes.api!.resources.total!.capacity).toBe(10_000);
    expect(r.summary.processingSuccessRate).toBeCloseTo(10_000 / 11_000);
  });

  it("losing every instance makes requests unroutable rather than silently dropped", () => {
    const r = simulate(urlShortenerWithCache(4, 0.8), STAGE2, {
      failures: [{ kind: "app-instance-failure", nodeId: "api", count: 4 }],
    });
    expect(r.summary.processingSuccessRate).toBe(0);
    expect(r.events.some((e) => e.kind === "unroutable")).toBe(true);
  });
});

describe("request outcome categories", () => {
  it("keeps accepted, processing succeeded, published and delivered distinct", () => {
    // 1,250 rps of creates → API (1 instance, 1,000 rps) → DB writes (800/s) + required publish → queue (600/s) → 1 worker (200/s)
    const doc = notificationPipeline(1);
    for (const n of doc.nodes) {
      if (n.id === "api" && n.type === "api-server") n.config.instances = 1;
      if (n.id === "db" && n.type === "sql-database") n.config.writeCapacity = 800;
      if (n.id === "queue" && n.type === "message-queue") n.config.enqueueCapacity = 600;
    }

    const r = simulate(doc, { totalRps: 1_250 });
    const create = r.operations.create!;

    expect(create.offered).toBeCloseTo(1_250);
    expect(create.accepted).toBeCloseTo(1_000); // entry admission at the API
    expect(create.publications[0]!.attempted).toBeCloseTo(1_000);
    expect(create.publications[0]!.published).toBeCloseTo(600); // broker accepted 60%
    expect(create.processingSucceeded).toBeCloseTo(1_000 * 0.8 * 0.6); // DB write AND publish must succeed: 480
    expect(r.deliveries).toEqual([
      expect.objectContaining({ inflow: 600, consumed: 200, backlogGrowthPerSec: 400, consumerSuccessRate: 1 }),
    ]);
  });

  it("an optional publish does not fail the request when the broker rejects it", () => {
    const doc = notificationPipeline(10);
    for (const n of doc.nodes) {
      if (n.id === "queue" && n.type === "message-queue") n.config.enqueueCapacity = 500;
      if (n.id === "api" && n.type === "api-server") {
        const publish = n.flows!.create![1]!;
        if (publish.type === "publish") publish.optional = true;
      }
    }
    const r = simulate(doc, { totalRps: 1_000 });
    expect(r.operations.create!.processingSuccessRate).toBeCloseTo(1);
    expect(r.operations.create!.publications[0]!.published).toBeCloseTo(500);
  });
});

describe("asynchronous processing", () => {
  it("worker down: publishing still succeeds, nothing is delivered, the backlog grows at the inflow rate", () => {
    const r = simulate(notificationPipeline(10), { totalRps: 1_000 }, { failures: [{ kind: "worker-down", nodeId: "worker" }] });

    const create = r.operations.create!;
    expect(create.processingSuccessRate).toBeCloseTo(1);
    expect(create.publications).toHaveLength(1);
    expect(create.publications[0]!.published).toBeCloseTo(1_000);

    expect(r.nodes.queue!.queue!.consumed).toBe(0);
    expect(r.nodes.queue!.queue!.backlogGrowthPerSec).toBeCloseTo(1_000);
    expect(r.deliveries).toEqual([
      expect.objectContaining({ consumerId: "worker", inflow: 1_000, consumed: 0, backlogGrowthPerSec: 1_000, consumerSuccessRate: null }),
    ]);
    expect(r.capacity!.instancesNeeded.worker).toBe(8); // demand still counts while the worker is down
    expect(r.nodes.queue!.queue!.secondsToFull).toBeCloseTo(1_000); // maxDepth 1,000,000
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "unmodeled", nodeIds: ["queue"] }));
  });

  it("under-provisioned workers fall behind without failing publishers", () => {
    const r = simulate(notificationPipeline(1), { totalRps: 1_000 });

    expect(r.operations.create!.processingSuccessRate).toBeCloseTo(1);
    expect(r.deliveries).toEqual([
      expect.objectContaining({ consumerId: "worker", inflow: 1_000, consumed: 200, backlogGrowthPerSec: 800, consumerSuccessRate: 1 }),
    ]);
    expect(r.capacity!.instancesNeeded.worker).toBe(8); // ceil(1,000 / (200 × 0.7))
  });

  it("delivery success reflects failures in the consumer's own flow", () => {
    const r = simulate(notificationPipeline(10), { totalRps: 1_000 }, {
      failures: [{ kind: "database-primary-down", nodeId: "audit" }],
    });
    expect(r.operations.create!.processingSuccessRate).toBeCloseTo(1);
    expect(r.deliveries[0]).toMatchObject({ consumed: 1_000, consumerSuccessRate: 0 });
  });
});

describe("capacity analysis", () => {
  it("finds the breaking point and first saturating resource exactly", () => {
    const noCache = simulate(urlShortenerNoCache(16), STAGE2).capacity!;
    expect(noCache.breakingPointRps).toBeCloseTo(5_500); // DB reads: 5,000 / (10/11)
    expect(noCache.firstSaturation).toEqual({ nodeId: "db", resource: "read" });

    const withCache = simulate(urlShortenerWithCache(16, 0.8), STAGE2).capacity!;
    expect(withCache.breakingPointRps).toBeCloseTo(16_000); // API servers: 16 × 1,000
    expect(withCache.firstSaturation).toEqual({ nodeId: "api", resource: "total" });
    expect(withCache.instancesNeeded.api).toBe(16); // ceil(11,000 / 700)
  });

  it("is independent of the current load (computed from demand, not admitted load)", () => {
    const a = simulate(urlShortenerNoCache(16), { totalRps: 1_100 }).capacity!;
    const b = simulate(urlShortenerNoCache(16), { totalRps: 50_000 }).capacity!;
    expect(a.breakingPointRps).toBeCloseTo(5_500);
    expect(b.breakingPointRps).toBeCloseTo(5_500);
  });

  it("loads scale linearly below saturation", () => {
    const x = simulate(urlShortenerWithCache(16), { totalRps: 2_000 });
    const y = simulate(urlShortenerWithCache(16), { totalRps: 4_000 });
    expect(y.nodes.db!.resources.read!.offered).toBeCloseTo(2 * x.nodes.db!.resources.read!.offered);
    expect(y.nodes.cache!.cache!.lookups).toBeCloseTo(2 * x.nodes.cache!.cache!.lookups);
  });
});

describe("determinism and validation", () => {
  it("returns deep-equal results for identical inputs", () => {
    const run = () => simulate(urlShortenerWithIdleReplica(16), STAGE2, { failures: [{ kind: "database-primary-down", nodeId: "db" }] });
    expect(run()).toEqual(run());
  });

  it("attaches the assumptions it relies on", () => {
    const r = simulate(urlShortenerWithCache(16), STAGE2);
    expect(r.assumptions).toEqual(expect.arrayContaining(["A-OVERLOAD-SHED", "A-NO-SHORT-CIRCUIT", "A-CACHE-ERROR-AS-MISS"]));
  });

  it.each([
    [
      "a step using a connection that does not start at the node",
      (d: ArchitectureDocument) => {
        const api = d.nodes.find((n) => n.id === "api");
        if (api?.type === "api-server") api.flows = { redirect: [{ type: "call", edge: "lb->api" }], create: [] };
      },
      "STEP_EDGE_INVALID",
    ],
    [
      "publish to something that is not a queue",
      (d: ArchitectureDocument) => {
        const api = d.nodes.find((n) => n.id === "api");
        if (api?.type === "api-server") api.flows = { redirect: [{ type: "publish", edge: "api->db" }] };
      },
      "PUBLISH_TARGET",
    ],
    [
      "a cache lookup whose on-miss steps call the same cache",
      (d: ArchitectureDocument) => {
        const api = d.nodes.find((n) => n.id === "api");
        if (api?.type === "api-server")
          api.flows = { redirect: [{ type: "cache-lookup", edge: "api->cache", onMiss: [{ type: "call", edge: "api->cache" }] }] };
      },
      "LOOKUP_SELF",
    ],
    [
      "a connection the catalog does not allow",
      (d: ArchitectureDocument) => {
        d.edges.push({ id: "db->client", source: "db", target: "client" });
      },
      "INVALID_CONNECTION",
    ],
  ])("rejects %s", (_name, mutate, code) => {
    const doc = urlShortenerWithCache(16);
    mutate(doc);
    const r = simulate(doc, STAGE2);
    expect(r.status).toBe("invalid");
    expect(r.issues.map((i) => i.code)).toContain(code);
  });

  it("rejects a cycle", () => {
    const doc = urlShortenerNoCache(2);
    doc.nodes.push({ id: "api2", type: "api-server", label: "API 2", config: {}, flows: { redirect: [{ type: "call", edge: "api2->api" }] } });
    doc.edges.push({ id: "api->api2", source: "api", target: "api2" }, { id: "api2->api", source: "api2", target: "api" });
    const api = doc.nodes.find((n) => n.id === "api");
    if (api?.type === "api-server") api.flows = { ...api.flows, redirect: [{ type: "call", edge: "api->api2" }] };

    const r = simulate(doc, STAGE2);
    expect(r.status).toBe("invalid");
    expect(r.issues.map((i) => i.code)).toContain("CYCLE");
  });
});
