import type { ArchitectureDocument } from "@sdl/architecture";

/** URL Shortener without a cache: client → LB → API (16 instances) → PostgreSQL, 1,000 rps saved traffic. */
export function urlShortenerDesign(): ArchitectureDocument {
  return {
    schemaVersion: 1,
    operations: [
      { id: "redirect", name: "Follow short link", kind: "read", share: 10 },
      { id: "create", name: "Create short link", kind: "write", share: 1 },
    ],
    nodes: [
      { id: "client", type: "web-client", label: "Browser", config: { share: 1 } },
      { id: "lb", type: "load-balancer", label: "Load balancer", config: { capacityRps: 50_000 } },
      {
        id: "api",
        type: "api-server",
        label: "API server",
        config: { instances: 16, capacityPerInstanceRps: 1000 },
        flows: { redirect: [{ type: "call", edge: "api-db" }], create: [{ type: "call", edge: "api-db" }] },
      },
      {
        id: "db",
        type: "sql-database",
        label: "PostgreSQL",
        config: { readCapacity: 5000, writeCapacity: 2000 },
      },
    ],
    edges: [
      { id: "client-lb", source: "client", target: "lb" },
      { id: "lb-api", source: "lb", target: "api" },
      { id: "api-db", source: "api", target: "db" },
    ],
    layout: { client: { x: 0, y: 0 }, lb: { x: 250, y: 0 }, api: { x: 500, y: 0 }, db: { x: 750, y: 0 } },
    traffic: { totalRps: 1000 },
  };
}
