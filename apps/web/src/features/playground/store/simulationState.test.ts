import { urlShortenerDesign } from "../test/designs";
import { COALESCE_MS, createEditorStore, NO_FAILURES } from "./editorStore";

function setup() {
  let time = 1_000_000;
  const store = createEditorStore(urlShortenerDesign(), () => time);
  return { s: () => store.getState(), advance: (ms: number) => (time += ms) };
}

describe("editor store simulation state", () => {
  it("saves traffic in the document as one undo step while it's being adjusted", () => {
    const { s, advance } = setup();
    const before = s().past.length;
    for (const rps of [2000, 5000, 11_000]) {
      s().setTraffic({ totalRps: rps });
      advance(100);
    }
    expect(s().doc.traffic).toEqual({ totalRps: 11_000 });
    expect(s().past.length).toBe(before + 1);

    advance(COALESCE_MS + 1);
    const revision = s().revision;
    s().setTraffic({ totalRps: 11_000 }); // no change, no history entry
    expect(s().revision).toBe(revision);
    s().setTraffic({ totalRps: 11_000, mix: { redirect: 1, create: 1 } });
    expect(s().doc.traffic?.mix).toEqual({ redirect: 1, create: 1 });
    s().undo();
    expect(s().doc.traffic).toEqual({ totalRps: 11_000 });
  });

  it("keeps failures out of the document and history, and drops them when their component goes", () => {
    const { s } = setup();
    s().setFailures([
      { kind: "database-primary-down", nodeId: "db" },
      { kind: "app-instance-failure", nodeId: "api", count: 2 },
      { kind: "worker-down", nodeId: "db" }, // doesn't apply to a database
    ]);
    expect(s().scenario.failures).toEqual([
      { kind: "database-primary-down", nodeId: "db" },
      { kind: "app-instance-failure", nodeId: "api", count: 2 },
    ]);
    expect(s().revision).toBe(0);
    expect(s().past).toHaveLength(0);

    const unchanged = s().scenario;
    s().renameNode("api", "API");
    expect(s().scenario).toBe(unchanged);

    s().setSelection({ nodeIds: ["db"], edgeIds: [] });
    s().deleteSelection();
    expect(s().scenario.failures).toEqual([{ kind: "app-instance-failure", nodeId: "api", count: 2 }]);

    s().load(urlShortenerDesign());
    expect(s().scenario).toBe(NO_FAILURES);
  });
});
