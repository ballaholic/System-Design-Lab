import { describe, expect, it } from "vitest";
import {
  addEdge,
  addNode,
  ArchitectureDocumentSchema,
  createEmptyDocument,
  createId,
  createNode,
  duplicateNodes,
  edgeSides,
  flowsOf,
  flowUsages,
  ID_PATTERN,
  nestingDepth,
  OPERATION_ID_PATTERN,
  operationIdFromName,
  removeEdges,
  removeNodes,
  removeOperation,
  setFlow,
  suggestSteps,
  updateNode,
  validateArchitecture,
  withEdgeSides,
} from "../src";
import { call, doc, lookup, publish, validDesign } from "./builder";

const flows = (d: ReturnType<typeof createEmptyDocument>, id: string) =>
  flowsOf(d.nodes.find((n) => n.id === id)!);

describe("ids", () => {
  it("createId produces prefixed ids matching the schema pattern", () => {
    const ids = new Set(Array.from({ length: 500 }, () => createId("n")));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(ID_PATTERN);
    expect(createId("e")).toMatch(/^e_/);
  });

  it("operationIdFromName slugs and de-duplicates", () => {
    expect(operationIdFromName("Follow short link", [])).toBe("follow-short-link");
    expect(operationIdFromName("Read", ["read"])).toBe("read-2");
    expect(operationIdFromName("Read", ["read", "read-2"])).toBe("read-3");
    expect(operationIdFromName("123 !!!", [])).toBe("operation");
    expect(operationIdFromName("Crème brûlée", [])).toBe("creme-brulee");
    expect(operationIdFromName("x".repeat(80), [])).toMatch(OPERATION_ID_PATTERN);
  });
});

describe("creating", () => {
  it("createEmptyDocument has read and write operations and passes the schema", () => {
    const d = createEmptyDocument();
    expect(d.operations.map((o) => o.id)).toEqual(["read", "write"]);
    expect(ArchitectureDocumentSchema.safeParse(d).success).toBe(true);
  });

  it("createNode uses defaults and unique labels", () => {
    let d = createEmptyDocument();
    const a = createNode(d, "api-server");
    d = addNode(d, a, { x: 1, y: 2 });
    const b = createNode(d, "api-server");
    d = addNode(d, b, { x: 3, y: 4 });
    const c = createNode(d, "api-server");
    expect([a.label, b.label, c.label]).toEqual(["API server", "API server 2", "API server 3"]);
    expect(a.config).toEqual({ instances: 2, capacityPerInstanceRps: 1000 });
    expect(d.layout[b.id]).toEqual({ x: 3, y: 4 });
    // Config is a copy, not the shared defaults object.
    (a.config as { instances: number }).instances = 9;
    expect(createNode(d, "api-server").config).toMatchObject({ instances: 2 });
  });

  it("addEdge, updateNode and setFlow", () => {
    let d = doc().node("api", "api-server").node("db", "sql-database").node("lb", "load-balancer").build();
    const { doc: d2, edge } = addEdge(d, "api", "db", "e1");
    expect(edge).toEqual({ id: "e1", source: "api", target: "db" });
    d = updateNode(d2, "db", (n) => ({ ...n, label: "Primary" }));
    expect(d.nodes[1]!.label).toBe("Primary");
    d = setFlow(d, "api", "read", [call("e1")]);
    expect(flows(d, "api")).toEqual({ read: [call("e1")] });
    d = setFlow(d, "api", "read", null);
    expect(flows(d, "api")).toEqual({});
    expect(setFlow(d, "lb", "read", [])).toEqual(d); // not a flow node
  });
});

describe("connection sides", () => {
  const twoBoxes = () => doc().node("api", "api-server").node("db", "sql-database").build();

  it("default to right and left, and only sides that differ are stored", () => {
    const { doc: plain } = addEdge(twoBoxes(), "api", "db", "e1");
    expect(plain).not.toHaveProperty("edgeLayout");
    expect(edgeSides(plain, "e1")).toEqual({ source: "right", target: "left" });

    const { doc: stacked } = addEdge(twoBoxes(), "api", "db", "e1", { source: "bottom", target: "top" });
    expect(stacked.edgeLayout).toEqual({ e1: { source: "bottom", target: "top" } });
    expect(edgeSides(stacked, "e1")).toEqual({ source: "bottom", target: "top" });
    expect(ArchitectureDocumentSchema.safeParse(stacked).success).toBe(true);

    const { doc: half } = addEdge(twoBoxes(), "api", "db", "e1", { source: "right", target: "top" });
    expect(half.edgeLayout).toEqual({ e1: { target: "top" } });
    expect(withEdgeSides(half, "e1", { source: "right", target: "left" })).not.toHaveProperty("edgeLayout");
  });

  it("are removed with their connection and copied with duplicates", () => {
    const base = doc().node("api", "api-server").node("db", "sql-database").node("c", "redis-cache").build();
    let d = addEdge(base, "api", "db", "e1", { source: "bottom", target: "top" }).doc;
    d = addEdge(d, "api", "c", "e2", { target: "bottom" }).doc;

    expect(removeEdges(d, ["e1"]).edgeLayout).toEqual({ e2: { target: "bottom" } });
    expect(removeNodes(d, ["api"])).not.toHaveProperty("edgeLayout");

    const copy = duplicateNodes(d, ["api", "db"]);
    const copied = copy.doc.edges.find((e) => e.source === copy.nodeIds[0] && e.target === copy.nodeIds[1])!;
    expect(edgeSides(copy.doc, copied.id)).toEqual({ source: "bottom", target: "top" });
  });
});

describe("removing", () => {
  it("removeEdges removes steps that use the edge, in the same result", () => {
    const d = removeEdges(validDesign().build(), ["api-queue"]);
    expect(d.edges.some((e) => e.id === "api-queue")).toBe(false);
    expect(flows(d, "api").write).toEqual([
      call("api-db"),
      call("api-cache", { as: "write", optional: true }),
    ]);
  });

  it("removing a cache connection keeps its on-miss steps", () => {
    const d = removeEdges(validDesign().build(), ["api-cache"]);
    expect(flows(d, "api").read).toEqual([call("api-db")]);
    expect(validateArchitecture(d).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("removeEdges prunes nested steps and is a no-op for an empty list", () => {
    const original = validDesign().build();
    expect(removeEdges(original, [])).toBe(original);
    expect(flows(removeEdges(original, ["api-db"]), "api").read).toEqual([lookup("api-cache", [], true)]);
  });

  it("removeNodes removes connections, their steps and layout", () => {
    const original = validDesign().build();
    expect(removeNodes(original, [])).toBe(original);
    const d = removeNodes(original, ["db"]);
    expect(d.nodes.map((n) => n.id)).not.toContain("db");
    expect(d.edges.some((e) => e.source === "db" || e.target === "db")).toBe(false);
    expect(d.layout).not.toHaveProperty("db");
    expect(flows(d, "worker").write).toEqual([]);
    expect(flows(d, "api").read).toEqual([lookup("api-cache", [], true)]);
  });

  it("flowUsages lists flows that use an edge", () => {
    expect(flowUsages(validDesign().build(), ["api-db"])).toEqual([
      { nodeId: "api", operation: "read" },
      { nodeId: "api", operation: "write" },
    ]);
    expect(flowUsages(validDesign().build(), ["client-lb"])).toEqual([]);
  });

  it("removeOperation cleans flows, overrides, lists and traffic mix", () => {
    const d = validDesign()
      .node("mobile", "mobile-client", { config: { operations: ["read", "write"] } })
      .node("cdn", "cdn", { config: { cacheableOperations: ["read"] } })
      .build();
    const api = d.nodes.find((n) => n.id === "api")! as { flows: Record<string, unknown> };
    api.flows.read = [
      lookup("api-cache", [call("api-db", { operation: "write" })]),
      publish("api-queue", { message: "write" }),
    ];
    d.traffic = { totalRps: 100, mix: { read: 1, write: 2 } };

    const next = removeOperation(d, "write");
    expect(next.operations.map((o) => o.id)).toEqual(["read"]);
    expect(flows(next, "api")).toEqual({
      read: [lookup("api-cache", [call("api-db")]), publish("api-queue")],
    });
    expect(flows(next, "worker")).toEqual({});
    expect(next.nodes.find((n) => n.id === "mobile")!.config).toMatchObject({ operations: ["read"] });
    expect(next.traffic).toEqual({ totalRps: 100, mix: { read: 1 } });

    const readRemoved = removeOperation(d, "read");
    expect(readRemoved.nodes.find((n) => n.id === "cdn")!.config).toMatchObject({ cacheableOperations: [] });
    expect(removeOperation(createEmptyDocument(), "read")).not.toHaveProperty("traffic");
  });
});

describe("duplicateNodes", () => {
  it("copies nodes and inner connections with new ids, remapping flows", () => {
    const original = validDesign().build();
    const { doc: d, nodeIds } = duplicateNodes(original, ["api", "cache", "db"]);
    expect(nodeIds).toHaveLength(3);
    const [api, cache, db] = nodeIds.map((id) => d.nodes.find((n) => n.id === id)!);
    expect([api!.label, cache!.label, db!.label]).toEqual(["api 2", "cache 2", "db 2"]);
    expect(d.layout[api!.id]).toEqual({ x: original.layout.api!.x + 40, y: original.layout.api!.y + 40 });

    const inner = d.edges.filter((e) => nodeIds.includes(e.source));
    expect(inner).toHaveLength(2);
    const toCache = inner.find((e) => e.target === cache!.id)!;
    const toDb = inner.find((e) => e.target === db!.id)!;
    // The publish step used a connection outside the copied set, so it's dropped.
    expect(flowsOf(api!)).toEqual({
      read: [lookup(toCache.id, [call(toDb.id)], true)],
      write: [call(toDb.id), call(toCache.id, { as: "write", optional: true })],
    });
    expect(ArchitectureDocumentSchema.safeParse(d).success).toBe(true);
  });

  it("hoists on-miss steps when the lookup's connection isn't copied", () => {
    const { doc: d, nodeIds } = duplicateNodes(validDesign().build(), ["api", "db"], { x: 0, y: 0 });
    const api = d.nodes.find((n) => n.id === nodeIds[0])!;
    const toDb = d.edges.find((e) => e.source === api.id)!;
    expect(flowsOf(api).read).toEqual([call(toDb.id)]);
  });

  it("copies a node with no layout entry", () => {
    const d = validDesign().build();
    delete d.layout.client;
    const { doc: next, nodeIds } = duplicateNodes(d, ["client"]);
    expect(next.layout[nodeIds[0]!]).toEqual({ x: 40, y: 40 });
  });
});

describe("suggestSteps", () => {
  const base = () =>
    doc()
      .node("client", "web-client")
      .node("api", "api-server", { flows: { read: [call("api-db")], write: [call("api-db")] } })
      .node("db", "sql-database")
      .node("cache", "redis-cache")
      .node("queue", "message-queue")
      .node("db2", "nosql-database")
      .edge("client", "api")
      .edge("api", "db")
      .edge("api", "cache")
      .edge("api", "queue")
      .edge("api", "db2");

  it("suggests a cache lookup that wraps existing read steps, and a best-effort write", () => {
    const s = suggestSteps(base().build(), "api-cache");
    expect(s).toEqual([
      {
        operation: "read",
        description: expect.stringContaining("on a miss"),
        steps: [lookup("api-cache", [call("api-db")], true)],
      },
      {
        operation: "write",
        description: expect.stringContaining("best effort"),
        steps: [call("api-db"), call("api-cache", { as: "write", optional: true })],
      },
    ]);
  });

  it("suggests publish for queues and call for stores", () => {
    expect(suggestSteps(base().build(), "api-queue").map((s) => s.steps.at(-1))).toEqual([
      publish("api-queue"),
      publish("api-queue"),
    ]);
    expect(suggestSteps(base().build(), "api-db2")[0]!.steps.at(-1)).toEqual(call("api-db2"));
  });

  it("skips operations whose flow already uses the connection, and non-service sources", () => {
    expect(suggestSteps(base().build(), "api-db")).toEqual([]);
    expect(suggestSteps(base().build(), "client-api")).toEqual([]);
    expect(suggestSteps(base().build(), "missing")).toEqual([]);
  });

  it("offers every client operation to a service with no flows yet", () => {
    const d = doc().node("api", "api-server").node("db", "sql-database").edge("api", "db").build();
    const s = suggestSteps(d, "api-db");
    expect(s.map((x) => x.operation)).toEqual(["read", "write"]);
    expect(s[0]!.steps).toEqual([call("api-db")]);
    const withCache = doc().node("api", "api-server").node("c", "redis-cache").edge("api", "c").build();
    expect(suggestSteps(withCache, "api-c")[0]).toMatchObject({
      description: 'Look up "c" first',
      steps: [lookup("api-c", [], true)],
    });
  });

  it("keeps offering client operations a service doesn't handle yet, so accepting one doesn't hide the next", () => {
    const d = doc()
      .node("api", "api-server", { flows: { read: [call("api-db")] } })
      .node("db", "sql-database")
      .edge("api", "db")
      .build();
    d.operations.push({ id: "notify", name: "Notify", kind: "write", share: 0 });
    // "write" is still offered; the message-only "notify" isn't, because clients never send it.
    expect(suggestSteps(d, "api-db").map((x) => x.operation)).toEqual(["write"]);
  });

  it("a worker gets suggestions only for messages it handles", () => {
    const d = doc()
      .node("w", "background-worker", { flows: { write: [] } })
      .node("db", "sql-database")
      .edge("w", "db")
      .build();
    expect(suggestSteps(d, "w-db").map((s) => s.operation)).toEqual(["write"]);
    const none = doc().node("w", "background-worker").node("db", "sql-database").edge("w", "db").build();
    expect(suggestSteps(none, "w-db")).toEqual([]);
  });

  it("doesn't suggest a lookup that would nest too deeply", () => {
    const d = base()
      .node("cache2", "redis-cache")
      .node("cache3", "redis-cache")
      .edge("api", "cache2")
      .edge("api", "cache3")
      .build();
    const api = d.nodes.find((n) => n.id === "api")! as { flows: Record<string, unknown> };
    api.flows.read = [lookup("api-cache2", [lookup("api-cache3", [call("api-db")])])];
    expect(nestingDepth(api.flows.read as never)).toBe(3);
    expect(suggestSteps(d, "api-cache").map((s) => s.operation)).toEqual(["write"]);
    expect(nestingDepth([lookup("x")])).toBe(2);
    expect(nestingDepth([])).toBe(0);
  });
});
