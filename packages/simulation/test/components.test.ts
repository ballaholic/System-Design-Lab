import { describe, expect, it } from "vitest";
import { call, doc, lookup, publish } from "./builder";
import { run } from "./run";

const ONE_OP = [{ id: "get", name: "Get", kind: "read" as const, share: 1 }];
const READ_WRITE = [
  { id: "get", name: "Get", kind: "read" as const, share: 9 },
  { id: "put", name: "Put", kind: "write" as const, share: 1 },
];

describe("clients", () => {
  it("splits each operation between clients by traffic share, only among clients that send it", () => {
    const d = doc(READ_WRITE)
      .node("web", "web-client", { config: { share: 3 } })
      .node("mobile", "mobile-client", { config: { share: 1 } })
      .node("ops", "web-client", { config: { share: 100, operations: ["put"] } })
      .node("api", "api-server", { config: { instances: 10 }, flows: { get: [], put: [] } })
      .edge("web", "api")
      .edge("mobile", "api")
      .edge("ops", "api")
      .build();
    const r = run(d, { totalRps: 1_000 });

    expect(r.nodes.web!.byOperation.get!.offered).toBeCloseTo(900 * 0.75);
    expect(r.nodes.mobile!.byOperation.get!.offered).toBeCloseTo(900 * 0.25);
    expect(r.nodes.ops!.byOperation.get).toBeUndefined();
    expect(r.nodes.ops!.byOperation.put!.offered).toBeCloseTo((100 * 100) / 104);
    expect(r.nodes.web!.status).toBe("ok");
    expect(r.nodes.web!.explanation[0]).toMatch(/^Sends 678 requests\/s: Get 675\/s, Put 2\.9\/s\.$/);
  });

  it("uses the traffic mix override instead of operation shares", () => {
    const d = doc(READ_WRITE)
      .node("c", "web-client")
      .node("api", "api-server", { flows: { get: [], put: [] } })
      .edge("c", "api")
      .build();
    const r = run(d, { totalRps: 100, mix: { get: 1, put: 1 } });
    expect(r.operations.get!.offered).toBeCloseTo(50);
    expect(r.operations.put!.offered).toBeCloseTo(50);
  });
});

describe("API gateway", () => {
  const gateway = (config: Record<string, unknown>) =>
    doc(ONE_OP)
      .node("c", "web-client")
      .node("gw", "api-gateway", { config })
      .node("api", "api-server", { config: { instances: 100 }, flows: { get: [] } })
      .edge("c", "gw")
      .edge("gw", "api")
      .build();

  it("reports rejections as rate-limited when the rate limit is the binding constraint", () => {
    const r = run(gateway({ capacityRps: 50_000, rateLimitRps: 4_000 }), { totalRps: 5_000 });
    const gw = r.nodes.gw!;
    expect(gw.resources.total!.capacity).toBe(4_000);
    expect(gw.rateLimited).toBeCloseTo(1_000);
    expect(r.summary.processingSuccessRate).toBeCloseTo(0.8);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "rate-limited", nodeIds: ["gw"] }));
    expect(r.events.some((e) => e.kind === "saturated" && e.nodeIds.includes("gw"))).toBe(false);
    expect(gw.explanation).toContain("The rate limit of 4,000 rps rejects 1,000 requests/s.");
  });

  it("reports plain saturation when capacity, not the rate limit, binds", () => {
    const r = run(gateway({ capacityRps: 3_000, rateLimitRps: 4_000 }), { totalRps: 5_000 });
    expect(r.nodes.gw!.rateLimited).toBeUndefined();
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "saturated", nodeIds: ["gw"] }));
  });

  it("routes each operation to the services that handle it (path-based routing)", () => {
    const d = doc(READ_WRITE)
      .node("c", "web-client")
      .node("gw", "api-gateway")
      .node("reads", "api-server", { flows: { get: [] } })
      .node("writes", "api-server", { flows: { put: [] } })
      .edge("c", "gw")
      .edge("gw", "reads")
      .edge("gw", "writes")
      .build();
    const r = run(d, { totalRps: 1_000 });
    expect(r.edges["gw->reads"]).toBeCloseTo(900);
    expect(r.edges["gw->writes"]).toBeCloseTo(100);
  });
});

describe("CDN", () => {
  const cdn = (config: Record<string, unknown> = {}) =>
    doc(READ_WRITE)
      .node("c", "web-client")
      .node("cdn", "cdn", { config: { hitRate: 0.9, ...config } })
      .node("api", "api-server", { config: { instances: 1 }, flows: { get: [], put: [] } })
      .edge("c", "cdn")
      .edge("cdn", "api")
      .build();

  it("serves the hit rate of cacheable (read) operations at the edge and forwards the rest", () => {
    const r = run(cdn(), { totalRps: 10_000 });
    // 9,000 gets: 8,100 served at the edge, 900 forwarded. 1,000 puts: all forwarded.
    expect(r.edges["cdn->api"]).toBeCloseTo(1_900);
    expect(r.nodes.cdn!.cache).toMatchObject({ lookups: 9_000, effectiveHitRate: 0.9, otherOps: 1_000 });
    expect(r.nodes.cdn!.cache!.hits).toBeCloseTo(8_100);
    // The API (1,000 rps) admits 1,000 of 1,900.
    const a = 1_000 / 1_900;
    expect(r.operations.get!.processingSuccessRate).toBeCloseTo(0.9 + 0.1 * a);
    expect(r.operations.put!.processingSuccessRate).toBeCloseTo(a);
    expect(r.nodes.cdn!.explanation.at(-1)).toMatch(/^Serves 90% of cacheable requests at the edge/);
  });

  it("uses the configured cacheable operations and flags cached writes as not modeled", () => {
    const r = run(cdn({ cacheableOperations: ["put"] }), { totalRps: 1_000 });
    expect(r.edges["cdn->api"]).toBeCloseTo(900 + 10);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "unmodeled", nodeIds: ["cdn"] }));
  });

  it("rejects load above its capacity before anything is served", () => {
    const r = run(cdn({ capacityRps: 5_000 }), { totalRps: 10_000 });
    expect(r.operations.get!.accepted).toBeCloseTo(4_500);
    expect(r.nodes.cdn!.status).toBe("saturated");
  });

  it("explains when nothing it receives is cacheable", () => {
    const r = run(cdn({ cacheableOperations: [] }), { totalRps: 100 });
    expect(r.nodes.cdn!.explanation).toContain(
      "None of the requests it receives are cacheable, so it forwards all of them.",
    );
  });
});

describe("stores", () => {
  it("NoSQL and object storage use their own read and write capacities", () => {
    const d = doc(READ_WRITE)
      .node("c", "web-client")
      .node("api", "api-server", {
        config: { instances: 100 },
        flows: { get: [call("api->kv"), call("api->blobs")], put: [call("api->kv"), call("api->blobs")] },
      })
      .node("kv", "nosql-database")
      .node("blobs", "object-storage")
      .edge("c", "api")
      .edge("api", "kv")
      .edge("api", "blobs")
      .build();
    const r = run(d, { totalRps: 30_000 });
    expect(r.nodes.kv!.resources.read).toMatchObject({ capacity: 20_000, offered: 27_000 });
    expect(r.nodes.kv!.resources.write).toMatchObject({ capacity: 10_000, offered: 3_000 });
    expect(r.nodes.blobs!.resources.read).toMatchObject({ capacity: 50_000, offered: 27_000 });
    expect(r.nodes.kv!.status).toBe("saturated");
    expect(r.nodes.blobs!.status).toBe("ok");
  });

  it("a call can override which capacity it uses", () => {
    const d = doc(ONE_OP)
      .node("c", "web-client")
      .node("api", "api-server", { flows: { get: [call("api->db", { as: "write" })] } })
      .node("db", "sql-database")
      .edge("c", "api")
      .edge("api", "db")
      .build();
    const r = run(d, { totalRps: 100 });
    expect(r.nodes.db!.resources.write!.offered).toBeCloseTo(100);
    expect(r.nodes.db!.resources.read!.offered).toBe(0);
    expect(r.nodes.db!.byOperation.get).toEqual({ offered: 100, admitted: 100 });
  });
});

describe("queues and streams", () => {
  function messaging(broker: "message-queue" | "event-stream", brokerConfig: Record<string, unknown> = {}) {
    const ops = [
      { id: "order", name: "Place order", kind: "write" as const, share: 1 },
      { id: "placed", name: "Order placed", kind: "write" as const, share: 0 },
    ];
    return doc(ops)
      .node("c", "web-client")
      .node("api", "api-server", {
        config: { instances: 10 },
        flows: { order: [publish("api->b", { message: "placed" })] },
      })
      .node("b", broker, { config: brokerConfig })
      .node("email", "background-worker", { config: { instances: 10 }, flows: { placed: [] } })
      .node("billing", "background-worker", { config: { instances: 10 }, flows: { placed: [] } })
      .edge("c", "api")
      .edge("api", "b")
      .edge("b", "email")
      .edge("b", "billing")
      .build();
  }

  it("queue consumers compete: each message goes to one worker", () => {
    const r = run(messaging("message-queue"), { totalRps: 1_000 });
    expect(r.deliveries.map((d) => d.inflow)).toEqual([500, 500]);
    expect(r.nodes.b!.queue).toMatchObject({
      kind: "queue",
      accepted: 1_000,
      consumed: 1_000,
      consumerGroups: 2,
    });
  });

  it("stream consumer groups each receive every message", () => {
    const r = run(messaging("event-stream"), { totalRps: 1_000 });
    expect(r.deliveries.map((d) => d.inflow)).toEqual([1_000, 1_000]);
    expect(r.nodes.b!.queue).toMatchObject({ kind: "stream", accepted: 1_000, consumed: 2_000 });
    expect(r.nodes.b!.explanation).toContain("Each of the 2 consumer groups receives all 1,000 messages/s.");
  });

  it("a stream consumer can't use more instances than there are partitions", () => {
    const r = run(messaging("event-stream", { partitions: 2 }), { totalRps: 1_000 });
    // 2 usable instances × 200 msg/s = 400 per group, so each group lags by 600/s.
    expect(r.nodes.email!.resources.total!.capacity).toBe(400);
    expect(r.deliveries.map((d) => d.backlogGrowthPerSec)).toEqual([600, 600]);
    expect(r.nodes.b!.queue!.backlogGrowthPerSec).toBeCloseTo(1_200);
    expect(r.nodes.email!.explanation).toContain(
      "Only 2 of 10 instances can consume: the stream has 2 partitions.",
    );
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "backlog-growing", nodeIds: ["b"] }));
    expect(r.events.filter((e) => e.kind === "unmodeled" && e.message.includes("retention"))).toHaveLength(1);
  });

  it("publish success is broker acceptance, regardless of consumers", () => {
    const r = run(messaging("event-stream", { ingestCapacity: 250 }), { totalRps: 1_000 });
    expect(r.operations.order!.processingSuccessRate).toBeCloseTo(0.25);
    expect(r.operations.order!.publications[0]).toMatchObject({
      stepPath: [0],
      brokerId: "b",
      attempted: 1_000,
    });
    expect(r.operations.order!.publications[0]!.published).toBeCloseTo(250);
  });

  it("messages nobody handles stay in the backlog and are reported", () => {
    const d = messaging("message-queue");
    for (const n of d.nodes) if (n.type === "background-worker") n.flows = {};
    const r = run(d, { totalRps: 100 });
    expect(r.nodes.b!.queue!.backlogGrowthPerSec).toBeCloseTo(100);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "unroutable", nodeIds: ["b"] }));
  });
});

describe("node status and explanations", () => {
  it("goes from ok to warm to saturated as utilization rises", () => {
    const d = doc(ONE_OP)
      .node("c", "web-client")
      .node("api", "api-server", { config: { instances: 1 }, flows: { get: [] } })
      .edge("c", "api")
      .build();
    expect(run(d, { totalRps: 500 }).nodes.api!.status).toBe("ok");
    expect(run(d, { totalRps: 800 }).nodes.api!.status).toBe("warm");
    expect(run(d, { totalRps: 1_000 }).nodes.api!.status).toBe("saturated");
    const over = run(d, { totalRps: 4_000 }).nodes.api!;
    expect(over.explanation).toContain("Offered 4,000 requests/s vs capacity 1,000, so 75% are rejected.");
    expect(over.headroom).toBeCloseTo(0.25);
  });

  it("explains instance failures, cache effective hit rate and dropped fills", () => {
    const d = doc(ONE_OP)
      .node("c", "web-client")
      .node("api", "api-server", {
        config: { instances: 4 },
        flows: { get: [lookup("api->cache", [call("api->db")], true)] },
      })
      .node("cache", "redis-cache", { config: { capacityOps: 1_000 } })
      .node("db", "sql-database")
      .edge("c", "api")
      .edge("api", "cache")
      .edge("api", "db")
      .build();
    const r = run(
      d,
      { totalRps: 2_000 },
      { failures: [{ kind: "app-instance-failure", nodeId: "api", count: 1 }] },
    );
    expect(r.nodes.api!.explanation).toContain("1 of 4 instances failed, leaving capacity 3,000 rps.");
    expect(
      r.nodes.cache!.explanation.some((l) => l.startsWith("Effective hit rate 40% (configured 80%)")),
    ).toBe(true);
    expect(r.nodes.cache!.explanation.some((l) => l.includes("cache fills/s are dropped"))).toBe(true);
  });

  it("explains a down component that still receives traffic", () => {
    const d = doc(ONE_OP)
      .node("c", "web-client")
      .node("api", "api-server", { flows: { get: [call("api->db")] } })
      .node("db", "sql-database")
      .edge("c", "api")
      .edge("api", "db")
      .build();
    const r = run(d, { totalRps: 100 }, { failures: [{ kind: "database-primary-down", nodeId: "db" }] });
    expect(r.nodes.db!.explanation).toEqual(["Down: all 100 reads/s offered are rejected."]);
    expect(r.nodes.db!.headroom).toBe(0);
  });
});
