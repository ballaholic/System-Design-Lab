import type { ArchitectureDocument } from "@sdl/architecture";
import { call, doc, lookup, publish } from "./builder";

/**
 * A valid document of exactly `nodes` components shaped like a real design:
 * a client and gateway, then cells of 10: LB → 2 API servers → cache + DB + queue → 2 workers → NoSQL, plus
 * an unused object store.
 */
export function largeDesign(nodes = 150): ArchitectureDocument {
  const ops = [
    { id: "redirect", name: "Follow short link", kind: "read" as const, share: 10 },
    { id: "create", name: "Create short link", kind: "write" as const, share: 1 },
    { id: "notify", name: "Notify", kind: "write" as const, share: 0 },
  ];
  const b = doc(ops)
    .node("client", "web-client")
    .node("gw", "api-gateway", { config: { capacityRps: 10_000_000 } });
  b.edge("client", "gw");
  const cells = (nodes - 2) / 10;
  for (let c = 0; c < Math.floor(cells); c++) {
    const p = (s: string) => `${s}${c}`;
    b.node(p("lb"), "load-balancer");
    b.edge("gw", p("lb"));
    for (const api of [p("apiA"), p("apiB")]) {
      b.node(api, "api-server", {
        config: { instances: 10 },
        flows: {
          redirect: [lookup(`${api}->${p("cache")}`, [call(`${api}->${p("db")}`)], true)],
          create: [
            call(`${api}->${p("db")}`),
            call(`${api}->${p("cache")}`, { as: "write", optional: true }),
            publish(`${api}->${p("queue")}`, { message: "notify" }),
          ],
        },
      });
      b.edge(p("lb"), api).edge(api, p("cache")).edge(api, p("db")).edge(api, p("queue"));
    }
    b.node(p("cache"), "redis-cache").node(p("db"), "sql-database").node(p("queue"), "message-queue");
    for (const w of [p("wA"), p("wB")]) {
      b.node(w, "background-worker", { flows: { notify: [call(`${w}->${p("kv")}`)] } });
      b.edge(p("queue"), w).edge(w, p("kv"));
    }
    b.node(p("kv"), "nosql-database");
    b.node(p("stats"), "object-storage");
  }
  // Pad to the exact size with clients that send nothing.
  const d = b.build();
  while (d.nodes.length < nodes) {
    const id = `extra${d.nodes.length}`;
    d.nodes.push({ id, type: "mobile-client", label: id, config: { share: 0, operations: [] } });
  }
  return d;
}
