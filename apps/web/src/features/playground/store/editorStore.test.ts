import { createEmptyDocument, flowsOf, LIMITS } from "@sdl/architecture";
import { COALESCE_MS, createEditorStore, HISTORY_LIMIT } from "./editorStore";

function setup() {
  let time = 1_000_000;
  const clock = { advance: (ms: number) => (time += ms) };
  const store = createEditorStore(createEmptyDocument(), () => time);
  return { store, s: () => store.getState(), clock };
}

describe("editor store history", () => {
  it("undo and redo restore exact prior documents for add, connect, config, move and delete", () => {
    const { s, clock } = setup();
    const snapshots = [s().doc];

    const lb = s().addComponent("load-balancer", { x: 0, y: 0 });
    const api = s().addComponent("api-server", { x: 200, y: 0 });
    if (!lb.ok || !api.ok) throw new Error("add failed");
    snapshots.push(s().past.at(-1)!, s().doc);
    const edge = s().connect(lb.value, api.value);
    expect(edge.ok).toBe(true);
    snapshots.push(s().doc);
    clock.advance(5000);
    s().setNodeConfig(api.value, "instances", 4);
    snapshots.push(s().doc);
    clock.advance(5000);
    s().moveNodes({ [api.value]: { x: 300, y: 50 } });
    snapshots.push(s().doc);
    s().setSelection({ nodeIds: [lb.value], edgeIds: [] });
    s().deleteSelection();
    snapshots.push(s().doc);

    expect(s().doc.nodes).toHaveLength(1);
    expect(s().doc.edges).toHaveLength(0);

    // Walk all the way back, checking each step equals the recorded state, then forward again.
    const states = [s().doc];
    while (s().past.length > 0) {
      s().undo();
      states.push(s().doc);
    }
    expect(states.at(-1)).toEqual(createEmptyDocument());
    expect(s().doc.nodes).toHaveLength(0);
    const forward = [s().doc];
    while (s().future.length > 0) {
      s().redo();
      forward.push(s().doc);
    }
    expect(forward.reverse()).toEqual(states);
    expect(s().doc.layout[api.value]).toEqual({ x: 300, y: 50 });
  });

  it("coalesces rapid edits with the same key into one undo step", () => {
    const { s, clock } = setup();
    const api = s().addComponent("api-server", { x: 0, y: 0 });
    if (!api.ok) throw new Error();
    const pastBefore = s().past.length;
    for (const v of [1, 12, 123]) {
      s().setNodeConfig(api.value, "capacityPerInstanceRps", v);
      clock.advance(200);
    }
    expect(s().past.length).toBe(pastBefore + 1);
    s().undo();
    expect(s().doc.nodes[0]!.config).toMatchObject({ capacityPerInstanceRps: 1000 });
  });

  it("starts a new undo step after the coalesce window or for a different field", () => {
    const { s, clock } = setup();
    const api = s().addComponent("api-server", { x: 0, y: 0 });
    if (!api.ok) throw new Error();
    const start = s().past.length;
    s().setNodeConfig(api.value, "instances", 3);
    clock.advance(COALESCE_MS + 1);
    s().setNodeConfig(api.value, "instances", 4);
    s().setNodeConfig(api.value, "capacityPerInstanceRps", 10);
    expect(s().past.length).toBe(start + 3);
  });

  it("one move is one undo step, and an unchanged move adds nothing", () => {
    const { s } = setup();
    const a = s().addComponent("api-server", { x: 0, y: 0 });
    const b = s().addComponent("sql-database", { x: 0, y: 100 });
    if (!a.ok || !b.ok) throw new Error();
    const before = s().past.length;
    s().moveNodes({ [a.value]: { x: 10.4, y: 20.6 }, [b.value]: { x: 30, y: 40 } });
    expect(s().past.length).toBe(before + 1);
    expect(s().doc.layout[a.value]).toEqual({ x: 10, y: 21 });
    s().moveNodes({ [a.value]: { x: 10, y: 21 } });
    expect(s().past.length).toBe(before + 1);
  });

  it("caps history and clears the redo stack on a new edit", () => {
    const { s, clock } = setup();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      s().setNotes(`note ${i}`);
      clock.advance(COALESCE_MS + 1);
    }
    expect(s().past.length).toBe(HISTORY_LIMIT);
    s().undo();
    expect(s().future.length).toBe(1);
    s().setNotes("new");
    expect(s().future.length).toBe(0);
  });

  it("undo and redo with empty stacks do nothing", () => {
    const { s } = setup();
    const revision = s().revision;
    s().undo();
    s().redo();
    expect(s().revision).toBe(revision);
  });

  it("load replaces the document and clears history", () => {
    const { s } = setup();
    s().addComponent("api-server", { x: 0, y: 0 });
    s().load(createEmptyDocument());
    expect(s()).toMatchObject({ past: [], future: [], revision: 0, selection: { nodeIds: [], edgeIds: [] } });
  });
});

describe("editor store actions", () => {
  it("refuses invalid connections with the rule's explanation", () => {
    const { s } = setup();
    const db = s().addComponent("sql-database", { x: 0, y: 0 });
    const client = s().addComponent("web-client", { x: 0, y: 0 });
    if (!db.ok || !client.ok) throw new Error();
    const revision = s().revision;
    const result = s().connect(db.value, client.value);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("only starts requests") });
    expect(s().revision).toBe(revision);
  });

  it("connects between the sides the line was drawn from and to", () => {
    const { s } = setup();
    const api = s().addComponent("api-server", { x: 0, y: 0 });
    const db = s().addComponent("sql-database", { x: 0, y: 200 });
    if (!api.ok || !db.ok) throw new Error();
    const edge = s().connect(api.value, db.value, { source: "bottom", target: "top" });
    if (!edge.ok) throw new Error();
    expect(s().doc.edgeLayout).toEqual({ [edge.value]: { source: "bottom", target: "top" } });
    s().undo();
    expect(s().doc).not.toHaveProperty("edgeLayout");
  });

  it("deleting an edge removes flow steps that use it in the same undo step", () => {
    const { s } = setup();
    const api = s().addComponent("api-server", { x: 0, y: 0 });
    const db = s().addComponent("sql-database", { x: 0, y: 0 });
    if (!api.ok || !db.ok) throw new Error();
    const edge = s().connect(api.value, db.value);
    if (!edge.ok) throw new Error();
    s().setNodeFlow(api.value, "read", [{ type: "call", edge: edge.value }]);
    s().deleteEdges([edge.value]);
    expect(flowsOf(s().doc.nodes[0]!).read).toEqual([]);
    s().undo();
    expect(s().doc.edges).toHaveLength(1);
    expect(flowsOf(s().doc.nodes[0]!).read).toEqual([{ type: "call", edge: edge.value }]);
  });

  it("duplicates the selection and selects the copies", () => {
    const { s } = setup();
    expect(s().duplicateSelection()).toMatchObject({ ok: false });
    const api = s().addComponent("api-server", { x: 0, y: 0 });
    if (!api.ok) throw new Error();
    const result = s().duplicateSelection();
    if (!result.ok) throw new Error();
    expect(s().doc.nodes.map((n) => n.label)).toEqual(["API server", "API server 2"]);
    expect(s().selection.nodeIds).toEqual(result.value);
  });

  it("enforces the component limit", () => {
    const { s } = setup();
    for (let i = 0; i < LIMITS.nodes; i++) s().addComponent("load-balancer", { x: i, y: 0 });
    expect(s().addComponent("load-balancer", { x: 0, y: 0 })).toMatchObject({ ok: false });
    expect(s().duplicateSelection()).toMatchObject({ ok: false, reason: expect.stringContaining("150") });
  });

  it("manages operations and keeps at least one", () => {
    const { s } = setup();
    const id = s().addOperation();
    expect(id).toBe("new-operation");
    expect(s().addOperation()).toBe("new-operation-2");
    s().updateOperation("new-operation", { name: "Search", kind: "read", share: 3 });
    expect(s().doc.operations[2]).toMatchObject({ id: "new-operation", name: "Search", share: 3 });
    s().deleteOperation("new-operation");
    s().deleteOperation("new-operation-2");
    s().deleteOperation("write");
    s().deleteOperation("read");
    expect(s().doc.operations.map((o) => o.id)).toEqual(["read"]);
  });

  it("renames nodes and labels edges, removing empty labels", () => {
    const { s } = setup();
    const a = s().addComponent("api-server", { x: 0, y: 0 });
    const b = s().addComponent("sql-database", { x: 0, y: 0 });
    if (!a.ok || !b.ok) throw new Error();
    s().renameNode(a.value, "Orders API");
    const e = s().connect(a.value, b.value);
    if (!e.ok) throw new Error();
    s().setEdgeLabel(e.value, "reads");
    expect(s().doc.edges[0]!.label).toBe("reads");
    s().setEdgeLabel(e.value, "  ");
    expect(s().doc.edges[0]).not.toHaveProperty("label");
    expect(s().doc.nodes[0]!.label).toBe("Orders API");
  });

  it("removes optional config values and notes when cleared", () => {
    const { s } = setup();
    const gw = s().addComponent("api-gateway", { x: 0, y: 0 });
    if (!gw.ok) throw new Error();
    s().setNodeConfig(gw.value, "rateLimitRps", 100);
    s().setNodeConfig(gw.value, "rateLimitRps", undefined);
    expect(s().doc.nodes[0]!.config).toEqual({ capacityRps: 50_000 });
    s().setNotes("hello");
    s().setNotes("");
    expect(s().doc).not.toHaveProperty("notes");
  });

  it("keeps issues in sync and prunes selection of deleted items", () => {
    const { s } = setup();
    const client = s().addComponent("web-client", { x: 0, y: 0 });
    if (!client.ok) throw new Error();
    expect(s().issues.map((i) => i.code)).toContain("OPERATION_UNROUTABLE");
    s().undo();
    expect(s().selection.nodeIds).toEqual([]);
    expect(s().issues).toEqual([]);
  });
});
