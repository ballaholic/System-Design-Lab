import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ArchitectureDocumentSchema,
  checkDocumentForSave,
  COMPONENT_TYPES,
  CURRENT_SCHEMA_VERSION,
  createEmptyDocument,
  documentByteSize,
  LIMITS,
  loadArchitecture,
  validateArchitecture,
} from "../src";
import { validDesign } from "./builder";
import { FIXTURES_DIR, SCHEMA_PATH, serializeSchema } from "./schemaFile";

const readFixtures = (version: string, kind: "valid" | "invalid") => {
  const dir = path.join(FIXTURES_DIR, version, kind);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ name: f, document: JSON.parse(readFileSync(path.join(dir, f), "utf8")) as unknown }));
};
const versions = () => readdirSync(FIXTURES_DIR).filter((d) => /^v\d+$/.test(d));

describe("schema fixtures (ADR-022)", () => {
  it("has a fixture directory for the current schema version", () => {
    expect(existsSync(path.join(FIXTURES_DIR, `v${CURRENT_SCHEMA_VERSION}`, "valid"))).toBe(true);
    expect(existsSync(path.join(FIXTURES_DIR, `v${CURRENT_SCHEMA_VERSION}`, "invalid"))).toBe(true);
  });

  for (const version of versions()) {
    for (const { name, document } of readFixtures(version, "valid")) {
      it(`${version}/valid/${name} migrates to the current version and passes the schema`, () => {
        const loaded = loadArchitecture(document);
        expect(loaded).toMatchObject({ ok: true, repairs: [] });
        if (loaded.ok) expect(ArchitectureDocumentSchema.safeParse(loaded.document).success).toBe(true);
      });
    }
  }

  for (const { name, document } of readFixtures(`v${CURRENT_SCHEMA_VERSION}`, "invalid")) {
    it(`v${CURRENT_SCHEMA_VERSION}/invalid/${name} fails the schema`, () => {
      expect(ArchitectureDocumentSchema.safeParse(document).success).toBe(false);
    });
  }

  it("the all-components fixture uses every component type", () => {
    const fixture = readFixtures(`v${CURRENT_SCHEMA_VERSION}`, "valid").find(
      (f) => f.name === "all-components.json",
    )!;
    const types = new Set((fixture.document as { nodes: Array<{ type: string }> }).nodes.map((n) => n.type));
    expect([...types].sort()).toEqual([...COMPONENT_TYPES].sort());
  });

  it("the valid design fixtures have no validation errors", () => {
    for (const { name, document } of readFixtures(`v${CURRENT_SCHEMA_VERSION}`, "valid")) {
      const loaded = loadArchitecture(document);
      if (!loaded.ok) throw new Error(name);
      const errors = validateArchitecture(loaded.document).filter((i) => i.severity === "error");
      // The minimal fixture is an empty canvas, which is valid but has nothing to simulate.
      expect(errors, name).toEqual([]);
    }
  });
});

describe("JSON Schema export", () => {
  it("the committed schemas/architecture.schema.json is up to date (run `pnpm --filter @sdl/architecture schema`)", () => {
    expect(readFileSync(SCHEMA_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(serializeSchema());
  });
});

describe("round trip", () => {
  it("parse → serialize → parse is lossless", () => {
    const original = validDesign().build();
    original.notes = "Notes survive";
    original.traffic = { totalRps: 5000, mix: { read: 3, write: 1 } };
    const first = ArchitectureDocumentSchema.parse(original);
    const second = ArchitectureDocumentSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
    expect(first).toEqual(original);
  });

  it("strips unknown keys", () => {
    const parsed = ArchitectureDocumentSchema.parse({ ...createEmptyDocument(), extra: true });
    expect(parsed).not.toHaveProperty("extra");
  });

  it("drops flows from components that can't have them", () => {
    const d = validDesign().build();
    (d.nodes[1] as unknown as Record<string, unknown>).flows = { read: [] };
    const parsed = ArchitectureDocumentSchema.parse(d);
    expect(parsed.nodes[1]).not.toHaveProperty("flows");
  });
});

describe("limits", () => {
  it("rejects more than the node limit", () => {
    const d = createEmptyDocument();
    d.nodes = Array.from({ length: LIMITS.nodes + 1 }, (_, i) => ({
      id: `n${i}`,
      type: "load-balancer" as const,
      label: `LB ${i}`,
      config: { capacityRps: 1000 },
    }));
    expect(ArchitectureDocumentSchema.safeParse(d).success).toBe(false);
  });

  it("checkDocumentForSave enforces schema and byte size", () => {
    expect(checkDocumentForSave(validDesign().build())).toEqual({ ok: true });
    expect(checkDocumentForSave({ schemaVersion: 1 })).toMatchObject({ ok: false });
    const big = createEmptyDocument();
    big.notes = "x".repeat(LIMITS.notesLength);
    big.nodes = Array.from({ length: LIMITS.nodes }, (_, i) => ({
      id: `node-${i}-${"x".repeat(50)}`,
      type: "api-server" as const,
      label: "y".repeat(LIMITS.labelLength),
      config: { instances: 1, capacityPerInstanceRps: 1 },
      flows: Object.fromEntries(
        Array.from({ length: 2 }, (_, k) => [
          k === 0 ? "read" : "write",
          Array.from({ length: LIMITS.stepsPerFlow }, () => ({
            type: "call" as const,
            edge: "e".repeat(64),
            operation: "read",
          })),
        ]),
      ),
    }));
    expect(documentByteSize(big)).toBeGreaterThan(LIMITS.documentBytes);
    expect(checkDocumentForSave(big)).toMatchObject({ ok: false, error: expect.stringContaining("256 KB") });
  });
});
