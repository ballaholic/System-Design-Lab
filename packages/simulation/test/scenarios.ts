// URL Shortener stage topologies and an async example, ported from the Phase 0 prototype
// (prototypes/simulation/src/scenarios.ts). Its tests are the regression baseline.

import type { ArchitectureDocument } from "@sdl/architecture";
import { call, doc, lookup, publish } from "./builder";

/** Stages 1–2 baseline: every request goes to PostgreSQL. */
export function urlShortenerNoCache(apiInstances: number): ArchitectureDocument {
  return doc()
    .node("client", "web-client", { label: "Browser" })
    .node("lb", "load-balancer", { label: "Load Balancer" })
    .node("api", "api-server", {
      label: "API Server",
      config: { instances: apiInstances },
      flows: { redirect: [call("api->db")], create: [call("api->db")] },
    })
    .node("db", "sql-database", { label: "PostgreSQL" })
    .edge("client", "lb")
    .edge("lb", "api")
    .edge("api", "db")
    .build();
}

/** Stage 2 improved: redirects check Redis first; creates write to PostgreSQL and invalidate Redis. */
export function urlShortenerWithCache(apiInstances: number, hitRate = 0.8): ArchitectureDocument {
  return doc()
    .node("client", "web-client", { label: "Browser" })
    .node("lb", "load-balancer", { label: "Load Balancer" })
    .node("api", "api-server", {
      label: "API Server",
      config: { instances: apiInstances },
      flows: {
        redirect: [lookup("api->cache", [call("api->db")], true)],
        create: [call("api->db"), call("api->cache", { as: "write", optional: true })],
      },
    })
    .node("db", "sql-database", { label: "PostgreSQL" })
    .node("cache", "redis-cache", { label: "Redis", config: { hitRate } })
    .edge("client", "lb")
    .edge("lb", "api")
    .edge("api", "db")
    .edge("api", "cache")
    .build();
}

/** Stage 3 variant: a second database is connected (meant as a replica) but no flow uses it. */
export function urlShortenerWithIdleReplica(apiInstances: number): ArchitectureDocument {
  const d = urlShortenerWithCache(apiInstances);
  d.nodes.push({
    id: "replica",
    type: "sql-database",
    label: "PostgreSQL Replica",
    config: { readCapacity: 5000, writeCapacity: 2000 },
  });
  d.layout.replica = { x: 0, y: 200 };
  d.edges.push({ id: "api->replica", source: "api", target: "replica" });
  return d;
}

/** Async example: creating a link publishes a notification that a worker writes to an audit DB. */
export function notificationPipeline(workerInstances: number): ArchitectureDocument {
  return doc([
    { id: "create", name: "Create link", kind: "write", share: 1 },
    { id: "notify", name: "Send notification", kind: "write", share: 0 }, // message-only
  ])
    .node("client", "mobile-client", { label: "App", config: { operations: ["create"] } })
    .node("api", "api-server", {
      label: "API Server",
      config: { instances: 4 },
      flows: { create: [call("api->db"), publish("api->queue", { message: "notify" })] },
    })
    .node("db", "sql-database", { label: "PostgreSQL" })
    .node("queue", "message-queue", { label: "Notifications Queue", config: { maxDepth: 1_000_000 } })
    .node("worker", "background-worker", {
      label: "Notifier",
      config: { instances: workerInstances },
      flows: { notify: [call("worker->audit")] },
    })
    .node("audit", "sql-database", { label: "Audit DB" })
    .edge("client", "api")
    .edge("api", "db")
    .edge("api", "queue")
    .edge("queue", "worker")
    .edge("worker", "audit")
    .build();
}

/** Stage traffic: 11,000 rps at 10:1, so 10,000 redirects/s and 1,000 creates/s. */
export const STAGE2 = { totalRps: 11_000 };
