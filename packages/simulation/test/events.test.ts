import { describe, expect, it } from "vitest";
import { call, doc } from "./builder";
import { run } from "./run";
import { STAGE2, urlShortenerNoCache, urlShortenerWithCache } from "./scenarios";

const kinds = (events: { kind: string }[]) => events.map((e) => e.kind);

describe("events", () => {
  it("reports each saturated resource of a store", () => {
    const r = run(urlShortenerNoCache(50), { totalRps: 30_000 });
    const db = r.events.filter((e) => e.nodeIds[0] === "db" && e.kind === "saturated").map((e) => e.message);
    expect(db).toEqual([
      '"PostgreSQL" (reads) is saturated at 545% of capacity.',
      '"PostgreSQL" (writes) is saturated at 136% of capacity.',
    ]);
  });

  it("says a worker can't keep up rather than that it rejects", () => {
    const d = doc([{ id: "order", name: "Order", kind: "write", share: 1 }])
      .node("c", "web-client")
      .node("api", "api-server", { flows: { order: [{ type: "publish", edge: "api->q" }] } })
      .node("q", "message-queue")
      .node("w", "background-worker", { flows: { order: [] } })
      .edge("c", "api")
      .edge("api", "q")
      .edge("q", "w")
      .build();
    const r = run(d, { totalRps: 1_000 });
    expect(r.events).toContainEqual({
      kind: "saturated",
      nodeIds: ["w"],
      message: '"w" can\'t keep up: it receives 1,000 messages/s and consumes 200.',
    });
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "backlog-growing", nodeIds: ["q"] }));
    expect(r.nodes.w!.resources.total).toMatchObject({ offered: 1_000, admitted: 200, rejected: 0 });
  });

  it("reports idle components that are connected but get nothing", () => {
    const d = urlShortenerNoCache(2);
    d.nodes.push({
      id: "spare",
      type: "api-server",
      label: "Spare",
      config: { instances: 1, capacityPerInstanceRps: 1000 },
    });
    d.edges.push({ id: "lb->spare", source: "lb", target: "spare" });
    const r = run(d, { totalRps: 100 });
    expect(r.events).toContainEqual({
      kind: "idle",
      nodeIds: ["spare"],
      message: '"Spare" receives no traffic.',
    });
  });

  it("reports a down component and the unmodeled consequences of each failure", () => {
    const r = run(urlShortenerWithCache(16), STAGE2, {
      failures: [
        { kind: "cache-down", nodeId: "cache" },
        { kind: "app-instance-failure", nodeId: "api", count: 2 },
      ],
    });
    expect(kinds(r.events)).toContain("down");
    const unmodeled = r.events.filter((e) => e.kind === "unmodeled").map((e) => e.message);
    expect(unmodeled.some((m) => m.startsWith('When "Redis" comes back it starts empty.'))).toBe(true);
    expect(unmodeled.some((m) => m.startsWith('Replacing failed instances of "API Server"'))).toBe(true);
  });

  it("reports how long until a bounded queue fills, in readable units", () => {
    const d = doc([{ id: "job", name: "Job", kind: "write", share: 1 }])
      .node("c", "web-client")
      .node("api", "api-server", { flows: { job: [{ type: "publish", edge: "api->q" }] } })
      .node("q", "message-queue")
      .node("w", "background-worker", { flows: { job: [call("w->db")] } })
      .node("db", "sql-database")
      .edge("c", "api")
      .edge("api", "q")
      .edge("q", "w")
      .edge("w", "db")
      .build();
    // 300 rps published and one worker consuming 200/s: the backlog grows by 100/s.
    const message = (maxDepth: number) => {
      configureDepth(d, maxDepth);
      return run(d, { totalRps: 300 }).events.find((e) => e.kind === "unmodeled" && e.nodeIds[0] === "q")
        ?.message;
    };
    expect(message(1_000)).toContain("in about 10 seconds");
    expect(message(100_000)).toContain("in about 17 minutes");
    expect(message(10_000_000)).toContain("in about 28 hours");
    expect(message(1_000_000_000)).toContain("in about 116 days");
  });
});

function configureDepth(d: ReturnType<typeof urlShortenerNoCache>, maxDepth: number) {
  const q = d.nodes.find((n) => n.id === "q")!;
  q.config = { ...q.config, maxDepth } as never;
}
