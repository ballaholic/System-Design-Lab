import { describe, expect, it } from "vitest";
import {
  CATALOG,
  createEmptyDocument,
  loadArchitecture,
  type Migration,
  migrateDocument,
  normalizeConfig,
} from "../src";
import { validDesign } from "./builder";

describe("migrations", () => {
  // A dummy v0 → v1 migration proves the framework: v0 called operations "requestTypes".
  const v0ToV1: Migration = {
    from: 0,
    description: "rename requestTypes to operations",
    migrate: ({ requestTypes, ...rest }) => ({ ...rest, operations: requestTypes }),
  };
  const v0 = {
    ...createEmptyDocument(),
    schemaVersion: 0,
    operations: undefined,
    requestTypes: createEmptyDocument().operations,
  };

  it("migrates v0 → v1 and loads the result", () => {
    const migrated = migrateDocument(v0, [v0ToV1], 1);
    expect(migrated).toMatchObject({ ok: true, from: 0, document: { schemaVersion: 1 } });
    const loaded = loadArchitecture(v0, [v0ToV1]);
    expect(loaded).toMatchObject({ ok: true, document: { operations: createEmptyDocument().operations } });
  });

  it("chains several migrations in order", () => {
    const calls: number[] = [];
    const step = (from: number): Migration => ({
      from,
      description: `${from}`,
      migrate: (d) => {
        calls.push(from);
        return d;
      },
    });
    expect(migrateDocument({ schemaVersion: 1 }, [step(2), step(1), step(3)], 4)).toMatchObject({
      ok: true,
      document: { schemaVersion: 4 },
    });
    expect(calls).toEqual([1, 2, 3]);
  });

  it("leaves current documents alone", () => {
    const d = createEmptyDocument();
    expect(migrateDocument(d)).toEqual({ ok: true, document: d, from: 1 });
  });

  it("fails clearly on missing migrations, newer versions and junk", () => {
    expect(migrateDocument(v0, [], 1)).toEqual({
      ok: false,
      error: expect.stringContaining("No migration from schema version 0"),
    });
    expect(migrateDocument({ schemaVersion: 7 })).toEqual({
      ok: false,
      error: expect.stringContaining("newer version"),
    });
    expect(migrateDocument({ schemaVersion: "1" })).toMatchObject({ ok: false });
    expect(migrateDocument({ schemaVersion: -1 })).toMatchObject({ ok: false });
    expect(migrateDocument(null)).toMatchObject({ ok: false });
    expect(migrateDocument([])).toMatchObject({ ok: false });
  });
});

describe("loadArchitecture", () => {
  it("loads a valid document without repairs", () => {
    const d = validDesign().build();
    expect(loadArchitecture(JSON.parse(JSON.stringify(d)))).toEqual({ ok: true, document: d, repairs: [] });
  });

  it("fills missing config fields from defaults and drops unknown ones", () => {
    const d = validDesign().build();
    (d.nodes[2] as { config: unknown }).config = { instances: 3, legacyThreads: 8 };
    const loaded = loadArchitecture(d);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.document.nodes[2]!.config).toEqual({ instances: 3, capacityPerInstanceRps: 1000 });
    expect(loaded.repairs).toEqual(['Reset invalid settings on "api" to defaults.']);
  });

  it("resets out-of-bounds values and unsets invalid optional ones", () => {
    const d = validDesign().build();
    (d.nodes[4] as { config: unknown }).config = { readCapacity: -5, writeCapacity: 10 };
    const loaded = loadArchitecture(d);
    expect(loaded.ok && loaded.document.nodes[4]!.config).toEqual({ readCapacity: 5000, writeCapacity: 10 });
    expect(normalizeConfig("api-gateway", { capacityRps: 10, rateLimitRps: 0 }).config).toEqual({
      capacityRps: 10,
    });
    expect(normalizeConfig("load-balancer", undefined)).toEqual({
      config: CATALOG["load-balancer"].defaults,
      changed: true,
    });
    expect(normalizeConfig("load-balancer", { capacityRps: 5 })).toEqual({
      config: { capacityRps: 5 },
      changed: false,
    });
  });

  it("drops unknown component types with their connections and layout", () => {
    const d = validDesign().build() as unknown as {
      nodes: Array<Record<string, unknown>>;
      edges: unknown[];
      layout: Record<string, unknown>;
    };
    d.nodes[4] = { id: "db", type: "mainframe", label: "Old", config: {} };
    const loaded = loadArchitecture(d);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.document.nodes.map((n) => n.id)).not.toContain("db");
    expect(loaded.document.edges.some((e) => e.target === "db")).toBe(false);
    expect(loaded.document.layout).not.toHaveProperty("db");
    expect(loaded.repairs).toEqual([
      'Removed a component of unknown type "mainframe".',
      "Removed connections to components that no longer exist.",
    ]);
  });

  it("drops connection sides of connections that no longer exist", () => {
    const d = {
      ...validDesign().build(),
      edgeLayout: { "api-db": { source: "bottom", target: "top" }, gone: { source: "top" } },
    };
    const loaded = loadArchitecture(d);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.document.edgeLayout).toEqual({ "api-db": { source: "bottom", target: "top" } });
    expect(loaded.repairs).toEqual([]);
  });

  it("quietly drops unusable connection sides, so older designs still load", () => {
    const d = {
      ...validDesign().build(),
      edgeLayout: {
        "api-db": { source: "left", target: "top" },
        "api-cache": { source: "middle" },
        "lb-api": "bottom",
      },
    };
    const loaded = loadArchitecture(d);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.document.edgeLayout).toEqual({ "api-db": { target: "top" } });
    expect(loaded.repairs).toEqual([]);
  });

  it("reports schema errors with a path", () => {
    const d = { ...createEmptyDocument(), operations: [] };
    expect(loadArchitecture(d)).toEqual({ ok: false, error: expect.stringContaining("operations") });
    expect(loadArchitecture({ schemaVersion: 1 })).toMatchObject({ ok: false });
  });
});
