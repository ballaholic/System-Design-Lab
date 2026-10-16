// URL Shortener stage topologies and an async notification example, used by tests and the report.

import type { ArchitectureDocument, ArchEdge, ArchNode, Operation } from "./model.js";

export const URL_SHORTENER_OPERATIONS: Operation[] = [
  { id: "redirect", name: "Follow short link", kind: "read", share: 10 },
  { id: "create", name: "Create short link", kind: "write", share: 1 },
];

const edge = (source: string, target: string): ArchEdge => ({ id: `${source}->${target}`, source, target });

/** Stage 1–2 baseline: every request goes to PostgreSQL. */
export function urlShortenerNoCache(apiInstances: number): ArchitectureDocument {
  const nodes: ArchNode[] = [
    { id: "client", type: "web-client", label: "Browser", config: {} },
    { id: "lb", type: "load-balancer", label: "Load Balancer", config: {} },
    {
      id: "api",
      type: "api-server",
      label: "API Server",
      config: { instances: apiInstances },
      flows: {
        redirect: [{ type: "call", edge: "api->db" }],
        create: [{ type: "call", edge: "api->db" }],
      },
    },
    { id: "db", type: "sql-database", label: "PostgreSQL", config: {} },
  ];
  return {
    schemaVersion: 1,
    operations: URL_SHORTENER_OPERATIONS,
    nodes,
    edges: [edge("client", "lb"), edge("lb", "api"), edge("api", "db")],
  };
}

/** Stage 2 improved: redirects check Redis first; creates write to PostgreSQL and invalidate Redis. */
export function urlShortenerWithCache(apiInstances: number, hitRate = 0.8): ArchitectureDocument {
  const base = urlShortenerNoCache(apiInstances);
  return {
    ...base,
    nodes: [
      ...base.nodes.map((n): ArchNode =>
        n.id === "api" && n.type === "api-server"
          ? {
              ...n,
              flows: {
                redirect: [
                  { type: "cache-lookup", edge: "api->cache", populate: true, onMiss: [{ type: "call", edge: "api->db" }] },
                ],
                create: [
                  { type: "call", edge: "api->db" },
                  { type: "call", edge: "api->cache", as: "write", optional: true },
                ],
              },
            }
          : n,
      ),
      { id: "cache", type: "redis-cache", label: "Redis", config: { hitRate } },
    ],
    edges: [...base.edges, edge("api", "cache")],
  };
}

/** Stage 3 variant: a second database is connected (e.g. intended as a replica) but no flow uses it. */
export function urlShortenerWithIdleReplica(apiInstances: number): ArchitectureDocument {
  const doc = urlShortenerWithCache(apiInstances);
  return {
    ...doc,
    nodes: [...doc.nodes, { id: "replica", type: "sql-database", label: "PostgreSQL Replica", config: {} }],
    edges: [...doc.edges, edge("api", "replica")],
  };
}

/** Async example: creating a link publishes a notification that a worker writes to an audit DB. */
export function notificationPipeline(workerInstances: number): ArchitectureDocument {
  const nodes: ArchNode[] = [
    { id: "client", type: "mobile-client", label: "App", config: {} },
    {
      id: "api",
      type: "api-server",
      label: "API Server",
      config: { instances: 4 },
      flows: {
        create: [
          { type: "call", edge: "api->db" },
          { type: "publish", edge: "api->queue", message: "notify" },
        ],
      },
    },
    { id: "db", type: "sql-database", label: "PostgreSQL", config: {} },
    { id: "queue", type: "message-queue", label: "Notifications Queue", config: { maxDepth: 1_000_000 } },
    {
      id: "worker",
      type: "background-worker",
      label: "Notifier",
      config: { instances: workerInstances },
      flows: { notify: [{ type: "call", edge: "worker->audit" }] },
    },
    { id: "audit", type: "sql-database", label: "Audit DB", config: {} },
  ];
  return {
    schemaVersion: 1,
    operations: [
      { id: "create", name: "Create link", kind: "write", share: 1 },
      { id: "notify", name: "Send notification", kind: "write", share: 0 }, // message-only
    ],
    nodes: nodes.map((n) => (n.type === "mobile-client" ? { ...n, config: { operations: ["create"] } } : n)),
    edges: [edge("client", "api"), edge("api", "db"), edge("api", "queue"), edge("queue", "worker"), edge("worker", "audit")],
  };
}
