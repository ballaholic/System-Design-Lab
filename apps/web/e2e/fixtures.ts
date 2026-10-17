/// <reference lib="dom" />
// The init script runs in the browser, so this file needs DOM types.
import type { Page } from "@playwright/test";

// Guest designs seeded straight into localStorage, in the format the app saves them (guestDesigns.ts).

type Doc = Record<string, unknown>;

const OPS = [
  { id: "redirect", name: "Follow short link", kind: "read", share: 10 },
  { id: "create", name: "Create short link", kind: "write", share: 1 },
];

/** URL Shortener stage 2 without a cache: every redirect reads PostgreSQL. */
export function urlShortener(options: { cache?: boolean; replica?: boolean } = {}): Doc {
  const nodes: Doc[] = [
    { id: "client", type: "web-client", label: "Browser", config: { share: 1 } },
    { id: "lb", type: "load-balancer", label: "Load balancer", config: { capacityRps: 50_000 } },
    {
      id: "api",
      type: "api-server",
      label: "API server",
      config: { instances: 16, capacityPerInstanceRps: 1000 },
      flows: options.cache
        ? {
            redirect: [
              {
                type: "cache-lookup",
                edge: "api-cache",
                populate: true,
                onMiss: [{ type: "call", edge: "api-db" }],
              },
            ],
            create: [{ type: "call", edge: "api-db" }],
          }
        : { redirect: [{ type: "call", edge: "api-db" }], create: [{ type: "call", edge: "api-db" }] },
    },
    {
      id: "db",
      type: "sql-database",
      label: "PostgreSQL",
      config: { readCapacity: 5000, writeCapacity: 2000 },
    },
  ];
  const edges: Doc[] = [
    { id: "client-lb", source: "client", target: "lb" },
    { id: "lb-api", source: "lb", target: "api" },
    { id: "api-db", source: "api", target: "db" },
  ];
  const layout: Record<string, { x: number; y: number }> = {
    client: { x: 0, y: 150 },
    lb: { x: 260, y: 150 },
    api: { x: 520, y: 150 },
    db: { x: 800, y: 260 },
  };
  if (options.cache) {
    nodes.push({
      id: "cache",
      type: "redis-cache",
      label: "Redis",
      config: { hitRate: 0.8, capacityOps: 100_000 },
    });
    edges.push({ id: "api-cache", source: "api", target: "cache" });
    layout.cache = { x: 800, y: 40 };
  }
  if (options.replica) {
    nodes.push({
      id: "replica",
      type: "sql-database",
      label: "Replica",
      config: { readCapacity: 5000, writeCapacity: 2000 },
    });
    edges.push({ id: "api-replica", source: "api", target: "replica" });
    layout.replica = { x: 800, y: 400 };
  }
  return { schemaVersion: 1, operations: OPS, nodes, edges, layout, traffic: { totalRps: 1000 } };
}

/** Creating a link publishes a notification that a worker writes to an audit database. */
export function notifications(): Doc {
  return {
    schemaVersion: 1,
    operations: [
      { id: "create", name: "Create link", kind: "write", share: 1 },
      { id: "notify", name: "Send notification", kind: "write", share: 0 },
    ],
    nodes: [
      { id: "client", type: "mobile-client", label: "App", config: { share: 1, operations: ["create"] } },
      {
        id: "api",
        type: "api-server",
        label: "API server",
        config: { instances: 4, capacityPerInstanceRps: 1000 },
        flows: {
          create: [
            { type: "call", edge: "api-db" },
            { type: "publish", edge: "api-queue", message: "notify" },
          ],
        },
      },
      {
        id: "db",
        type: "sql-database",
        label: "PostgreSQL",
        config: { readCapacity: 5000, writeCapacity: 2000 },
      },
      { id: "queue", type: "message-queue", label: "Notifications", config: { enqueueCapacity: 50_000 } },
      {
        id: "worker",
        type: "background-worker",
        label: "Notifier",
        config: { instances: 10, throughputPerInstance: 200 },
        flows: { notify: [{ type: "call", edge: "worker-audit" }] },
      },
      {
        id: "audit",
        type: "sql-database",
        label: "Audit DB",
        config: { readCapacity: 5000, writeCapacity: 2000 },
      },
    ],
    edges: [
      { id: "client-api", source: "client", target: "api" },
      { id: "api-db", source: "api", target: "db" },
      { id: "api-queue", source: "api", target: "queue" },
      { id: "queue-worker", source: "queue", target: "worker" },
      { id: "worker-audit", source: "worker", target: "audit" },
    ],
    layout: {
      client: { x: 0, y: 120 },
      api: { x: 260, y: 120 },
      db: { x: 540, y: 0 },
      queue: { x: 540, y: 240 },
      worker: { x: 800, y: 240 },
      audit: { x: 1060, y: 240 },
    },
    traffic: { totalRps: 1000 },
  };
}

/** Stores the design as a guest design and returns its playground URL. */
export async function seedGuestDesign(page: Page, title: string, doc: Doc): Promise<string> {
  const id = "local-00000000-0000-4000-8000-000000000001";
  await page.addInitScript(
    ({ id, title, doc }) => {
      if (window.localStorage.getItem(`sdl-guest-design:v1:${id}`)) return; // keep edits across reloads
      const now = new Date().toISOString();
      const summary = {
        id,
        title,
        nodeCount: (doc.nodes as unknown[]).length,
        createdAt: now,
        updatedAt: now,
      };
      window.localStorage.setItem("sdl-guest-designs:v1", JSON.stringify([summary]));
      window.localStorage.setItem(`sdl-guest-design:v1:${id}`, JSON.stringify(doc));
    },
    { id, title, doc },
  );
  return `/playground/${id}`;
}
