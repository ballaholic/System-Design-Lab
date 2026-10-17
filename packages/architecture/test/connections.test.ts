import { describe, expect, it } from "vitest";
import {
  CATALOG,
  checkConnection,
  checkConnectionTypes,
  COMPONENT_TYPES,
  type ComponentRole,
  roleOf,
} from "../src";
import { doc } from "./builder";

// Written out independently of ALLOWED_TARGET_ROLES so the test pins the intended rules.
const ALLOWED = new Set([
  "source>edge-cache",
  "source>distributor",
  "source>service",
  "edge-cache>distributor",
  "edge-cache>service",
  "distributor>distributor",
  "distributor>service",
  ...["service", "consumer"].flatMap((s) =>
    ["service", "distributor", "cache", "store", "queue", "stream"].map((t) => `${s}>${t}`),
  ),
  "queue>consumer",
  "stream>consumer",
]);

describe("connection rules", () => {
  const roles = [...new Set(COMPONENT_TYPES.map(roleOf))] as ComponentRole[];

  it("covers every role", () => {
    expect(roles.sort()).toEqual([
      "cache",
      "consumer",
      "distributor",
      "edge-cache",
      "queue",
      "service",
      "source",
      "store",
      "stream",
    ]);
  });

  for (const source of COMPONENT_TYPES) {
    for (const target of COMPONENT_TYPES) {
      const expected = ALLOWED.has(`${roleOf(source)}>${roleOf(target)}`);
      it(`${source} → ${target}: ${expected ? "allowed" : "refused"}`, () => {
        const result = checkConnectionTypes(source, target);
        expect(result.ok).toBe(expected);
        if (!result.ok) expect(result.reason.length).toBeGreaterThan(20);
      });
    }
  }

  it("explains why a database can't connect to a client", () => {
    const result = checkConnectionTypes("sql-database", "web-client");
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("only starts requests") });
  });

  it("explains that stores don't start requests", () => {
    expect(checkConnectionTypes("sql-database", "api-server")).toEqual({
      ok: false,
      reason: expect.stringContaining("doesn't start them"),
    });
    expect(checkConnectionTypes("redis-cache", "sql-database")).toEqual({
      ok: false,
      reason: expect.stringContaining("A cache"),
    });
  });

  it("points services at queues for background workers", () => {
    expect(checkConnectionTypes("api-server", "background-worker")).toEqual({
      ok: false,
      reason: expect.stringContaining("message queue"),
    });
  });

  it("tells clients to route through an API server", () => {
    expect(checkConnectionTypes("web-client", "sql-database")).toEqual({
      ok: false,
      reason: expect.stringContaining("Route through an API server"),
    });
  });

  it("explains broker and distributor limits", () => {
    expect(checkConnectionTypes("message-queue", "api-server")).toMatchObject({
      reason: expect.stringContaining("delivers messages"),
    });
    expect(checkConnectionTypes("load-balancer", "sql-database")).toMatchObject({
      reason: expect.stringContaining("forwards requests"),
    });
  });

  it("uses 'An' before vowels", () => {
    expect(checkConnectionTypes("object-storage", "web-client")).toMatchObject({ ok: false });
    expect(checkConnectionTypes("object-storage", "api-server")).toMatchObject({
      reason: expect.stringMatching(/^An object storage/),
    });
  });

  it("every component has a description and fields", () => {
    for (const type of COMPONENT_TYPES) {
      expect(CATALOG[type].description.length).toBeGreaterThan(10);
      expect(CATALOG[type].fields.length).toBeGreaterThan(0);
    }
  });
});

describe("checkConnection in a document", () => {
  const d = doc()
    .node("c", "web-client")
    .node("lb", "load-balancer")
    .node("db", "sql-database")
    .edge("c", "lb")
    .build();

  it("allows a valid new connection", () => {
    expect(checkConnection(d, "lb", "c")).toMatchObject({ ok: false }); // distributor → client
    const d2 = doc().node("lb", "load-balancer").node("api", "api-server").build();
    expect(checkConnection(d2, "lb", "api")).toEqual({ ok: true });
  });

  it("refuses self-connections, duplicates and missing nodes", () => {
    expect(checkConnection(d, "lb", "lb")).toEqual({ ok: false, reason: expect.stringContaining("itself") });
    expect(checkConnection(d, "c", "lb")).toEqual({
      ok: false,
      reason: expect.stringContaining("already connected"),
    });
    expect(checkConnection(d, "c", "missing")).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("refuses by type", () => {
    expect(checkConnection(d, "db", "c")).toMatchObject({ ok: false });
  });
});
