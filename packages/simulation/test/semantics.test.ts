import { CATALOG, COMPONENT_TYPES } from "@sdl/architecture";
import { describe, expect, it } from "vitest";
import { ASSUMPTION_IDS, ASSUMPTIONS, EVENT_DESCRIPTIONS, ROLE_SEMANTICS, STATUS_DESCRIPTIONS } from "../src";

describe("documentation registries", () => {
  it("describe every component type exactly once, under its catalog role", () => {
    const described = ROLE_SEMANTICS.flatMap((r) => r.types.map((type) => [type, r.role] as const));
    expect(described.map(([type]) => type).sort()).toEqual([...COMPONENT_TYPES].sort());
    for (const [type, role] of described) expect(CATALOG[type].role).toBe(role);
  });

  it("list every assumption with unique ids and text", () => {
    expect(new Set(ASSUMPTION_IDS).size).toBe(ASSUMPTIONS.length);
    expect(ASSUMPTIONS.length).toBe(11);
    for (const a of ASSUMPTIONS) expect(a.text.length).toBeGreaterThan(20);
  });

  it("describe every status and event kind", () => {
    expect(Object.keys(STATUS_DESCRIPTIONS).sort()).toEqual(["down", "idle", "ok", "saturated", "warm"]);
    expect(Object.keys(EVENT_DESCRIPTIONS)).toHaveLength(7);
  });
});
