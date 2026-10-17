import { createEmptyDocument, type ArchitectureDocument } from "@sdl/architecture";
import { EMPTY_SELECTION } from "../store/editorStore";
import { edgeCarries, toFlowEdges, toFlowNodes } from "./toFlow";

function design(): ArchitectureDocument {
  const d = createEmptyDocument();
  d.nodes = [
    { id: "c", type: "web-client", label: "Client", config: { share: 1 } },
    { id: "lb", type: "load-balancer", label: "LB", config: { capacityRps: 50_000 } },
    {
      id: "api",
      type: "api-server",
      label: "API",
      config: { instances: 2, capacityPerInstanceRps: 1000 },
      flows: {
        read: [{ type: "call", edge: "api-db" }],
        write: [{ type: "publish", edge: "api-q", message: "read" }],
      },
    },
    { id: "db", type: "sql-database", label: "DB", config: { readCapacity: 1, writeCapacity: 1 } },
    { id: "q", type: "message-queue", label: "Queue", config: { enqueueCapacity: 1 } },
    {
      id: "w",
      type: "background-worker",
      label: "Worker",
      config: { instances: 1, throughputPerInstance: 1 },
      flows: { read: [] },
    },
    { id: "spare", type: "nosql-database", label: "Spare", config: { readCapacity: 1, writeCapacity: 1 } },
  ];
  d.edges = [
    { id: "c-lb", source: "c", target: "lb" },
    { id: "lb-api", source: "lb", target: "api" },
    { id: "api-db", source: "api", target: "db" },
    { id: "api-q", source: "api", target: "q" },
    { id: "q-w", source: "q", target: "w" },
    { id: "api-spare", source: "api", target: "spare", label: "unused" },
  ];
  d.layout = { c: { x: 1, y: 2 } };
  return d;
}

describe("toFlow", () => {
  it("computes the operations each connection carries", () => {
    const carries = edgeCarries(design());
    expect([...carries.get("c-lb")!]).toEqual(["read", "write"]);
    expect([...carries.get("api-db")!]).toEqual(["read"]);
    expect([...carries.get("api-q")!]).toEqual(["read"]); // publish message override
    expect([...carries.get("q-w")!]).toEqual(["read"]);
    expect(carries.has("api-spare")).toBe(false);
  });

  it("maps nodes with layout, fallback positions, selection, issue levels and measured size", () => {
    const nodes = toFlowNodes(
      design(),
      { nodeIds: ["api"], edgeIds: [] },
      [
        { code: "A", severity: "warning", message: "", nodeIds: ["api"] },
        { code: "B", severity: "error", message: "", nodeIds: ["api"] },
        { code: "C", severity: "info", message: "", nodeIds: ["db"] },
      ],
      new Map([["c", { width: 200, height: 50 }]]),
    );
    expect(nodes[0]).toMatchObject({
      id: "c",
      position: { x: 1, y: 2 },
      measured: { width: 200, height: 50 },
    });
    expect(nodes[1]!.position).toEqual({ x: 220, y: 0 });
    expect(nodes[2]).toMatchObject({ selected: true, data: { issueLevel: "error", issueCount: 2 } });
    expect(nodes[3]!.data.issueLevel).toBeNull();
  });

  it("maps edges with async flag, carried operation names and labels", () => {
    const edges = toFlowEdges(design(), EMPTY_SELECTION, []);
    const byId = Object.fromEntries(edges.map((e) => [e.id, e]));
    expect(byId["api-q"]!.data).toMatchObject({ async: true, carries: ["Read"] });
    expect(byId["api-db"]!.data).toMatchObject({ async: false, carries: ["Read"] });
    expect(byId["api-spare"]!.data).toMatchObject({ carries: [], label: "unused" });
  });
});
