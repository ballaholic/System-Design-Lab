import { describe, expect, it } from "vitest";
import {
  type ArchitectureDocument,
  createEmptyDocument,
  evaluationOrder,
  hasBlockingIssues,
  validateArchitecture,
} from "../src";
import { call, codes, doc, lookup, publish, validDesign } from "./builder";

const issuesOf = (d: ArchitectureDocument) => validateArchitecture(d);
const has = (d: ArchitectureDocument, code: string) => codes(issuesOf(d)).includes(code);

describe("validateArchitecture: baseline", () => {
  it("a complete design has no issues", () => {
    expect(issuesOf(validDesign().build())).toEqual([]);
  });

  it("an empty canvas has no issues", () => {
    expect(issuesOf(createEmptyDocument())).toEqual([]);
  });

  it("is deterministic", () => {
    const d = doc().node("lb", "load-balancer").node("db", "sql-database").edge("db", "lb").build();
    expect(issuesOf(d)).toEqual(issuesOf(structuredClone(d)));
  });

  it("hasBlockingIssues only counts errors", () => {
    expect(hasBlockingIssues([{ code: "X", severity: "warning", message: "" }])).toBe(false);
    expect(hasBlockingIssues([{ code: "X", severity: "error", message: "" }])).toBe(true);
  });
});

describe("identity and structure", () => {
  it("DUPLICATE_NODE_ID / DUPLICATE_EDGE_ID / DUPLICATE_OPERATION_ID", () => {
    const d = validDesign().build();
    d.nodes.push({ ...d.nodes[1]! });
    d.edges.push({ ...d.edges[0]! });
    d.operations.push({ ...d.operations[0]! });
    const c = codes(issuesOf(d));
    expect(c).toEqual(
      expect.arrayContaining(["DUPLICATE_NODE_ID", "DUPLICATE_EDGE_ID", "DUPLICATE_OPERATION_ID"]),
    );
    expect(has(validDesign().build(), "DUPLICATE_NODE_ID")).toBe(false);
  });

  it("NO_CLIENT_TRAFFIC when every share is 0", () => {
    const d = validDesign().build();
    d.operations = d.operations.map((o) => ({ ...o, share: 0 }));
    expect(has(d, "NO_CLIENT_TRAFFIC")).toBe(true);
  });

  it("DANGLING_EDGE", () => {
    const d = validDesign().build();
    d.edges.push({ id: "ghost", source: "api", target: "nowhere" });
    expect(has(d, "DANGLING_EDGE")).toBe(true);
  });

  it("SELF_CONNECTION", () => {
    const d = validDesign().edge("api", "api").build();
    expect(has(d, "SELF_CONNECTION")).toBe(true);
  });

  it("INVALID_CONNECTION uses the connection rule's explanation", () => {
    const d = validDesign().edge("db", "client").build();
    const issue = issuesOf(d).find((i) => i.code === "INVALID_CONNECTION");
    expect(issue).toMatchObject({
      severity: "error",
      edgeIds: ["db-client"],
      message: expect.stringContaining("client"),
    });
  });

  it("DUPLICATE_CONNECTION is a warning", () => {
    const d = validDesign().edge("client", "lb", "second").build();
    expect(issuesOf(d).find((i) => i.code === "DUPLICATE_CONNECTION")).toMatchObject({ severity: "warning" });
  });

  it("CONFIG_INVALID names the field", () => {
    const d = validDesign().build();
    (d.nodes[2]!.config as Record<string, unknown>).instances = 0;
    expect(issuesOf(d).find((i) => i.code === "CONFIG_INVALID")?.message).toContain("Instances");
  });

  it("UNKNOWN_OPERATION_REFERENCE for stale client and CDN lists", () => {
    const d = validDesign().build();
    (d.nodes[0]!.config as Record<string, unknown>).operations = ["read", "gone"];
    expect(has(d, "UNKNOWN_OPERATION_REFERENCE")).toBe(true);
  });
});

describe("flows", () => {
  it("FLOW_UNKNOWN_OPERATION", () => {
    const d = validDesign().build();
    const api = d.nodes.find((n) => n.id === "api")! as { flows: Record<string, unknown> };
    api.flows.gone = [];
    expect(has(d, "FLOW_UNKNOWN_OPERATION")).toBe(true);
  });

  it("FLOW_TOO_LONG counts nested steps", () => {
    const many = Array.from({ length: 11 }, () => call("api-db"));
    const d = validDesign().build();
    const api = d.nodes.find((n) => n.id === "api")! as { flows: Record<string, unknown> };
    api.flows.read = [lookup("api-cache", many), ...many];
    expect(has(d, "FLOW_TOO_LONG")).toBe(true);
    expect(has(validDesign().build(), "FLOW_TOO_LONG")).toBe(false);
  });

  it("STEP_EDGE_INVALID for a connection that doesn't start at the node", () => {
    const d = doc()
      .node("client", "web-client")
      .node("api", "api-server", { flows: { read: [lookup("missing", [call("client-api")])], write: [] } })
      .edge("client", "api")
      .build();
    expect(codes(issuesOf(d)).filter((c) => c === "STEP_EDGE_INVALID")).toHaveLength(2);
  });

  it("LOOKUP_TARGET, PUBLISH_TARGET and CALL_TARGET", () => {
    const d = doc()
      .node("client", "web-client")
      .node("api", "api-server", {
        flows: { read: [lookup("api-db")], write: [publish("api-db"), call("api-queue")] },
      })
      .node("db", "sql-database")
      .node("queue", "message-queue")
      .edge("client", "api")
      .edge("api", "db")
      .edge("api", "queue")
      .build();
    expect(codes(issuesOf(d))).toEqual(
      expect.arrayContaining(["LOOKUP_TARGET", "PUBLISH_TARGET", "CALL_TARGET"]),
    );
  });

  it("LOOKUP_SELF when on-miss steps call the same cache", () => {
    const d = validDesign().build();
    const api = d.nodes.find((n) => n.id === "api")! as { flows: Record<string, unknown> };
    api.flows.read = [lookup("api-cache", [call("api-cache")])];
    expect(issuesOf(d).find((i) => i.code === "LOOKUP_SELF")?.message).toContain("populate");
  });

  it("STEP_UNKNOWN_OPERATION for call and publish overrides", () => {
    const d = validDesign().build();
    const api = d.nodes.find((n) => n.id === "api")! as { flows: Record<string, unknown> };
    api.flows.write = [call("api-db", { operation: "gone" }), publish("api-queue", { message: "gone" })];
    expect(codes(issuesOf(d)).filter((c) => c === "STEP_UNKNOWN_OPERATION")).toHaveLength(2);
  });

  it("CALL_TARGET_NO_FLOW for a service without the flow, and a distributor with nothing behind it", () => {
    const d = doc()
      .node("client", "web-client")
      .node("api", "api-server", { flows: { read: [call("api-auth"), call("api-lb2")], write: [] } })
      .node("auth", "api-server", { flows: { write: [] } })
      .node("lb2", "load-balancer")
      .edge("client", "api")
      .edge("api", "auth")
      .edge("api", "lb2")
      .build();
    const messages = issuesOf(d)
      .filter((i) => i.code === "CALL_TARGET_NO_FLOW")
      .map((i) => i.message);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('"auth" has no flow');
    expect(messages[1]).toContain("nothing behind it");
  });

  it("calls to a service with the flow are fine", () => {
    const d = doc()
      .node("client", "web-client")
      .node("api", "api-server", { flows: { read: [call("api-auth", { operation: "write" })], write: [] } })
      .node("auth", "api-server", { flows: { write: [] } })
      .edge("client", "api")
      .edge("api", "auth")
      .build();
    expect(codes(issuesOf(d)).filter((c) => c.startsWith("CALL"))).toEqual([]);
  });
});

describe("routing from clients", () => {
  it("OPERATION_UNROUTABLE for an unconnected client", () => {
    const d = doc().node("client", "web-client").build();
    expect(issuesOf(d)).toEqual([
      expect.objectContaining({
        code: "OPERATION_UNROUTABLE",
        message: expect.stringContaining("isn't connected"),
      }),
    ]);
  });

  it("OPERATION_UNROUTABLE lists operations nothing handles", () => {
    const d = doc()
      .node("client", "web-client")
      .node("api", "api-server", { flows: { read: [] } })
      .edge("client", "api")
      .build();
    const issue = issuesOf(d).find((i) => i.code === "OPERATION_UNROUTABLE");
    expect(issue?.message).toContain('"Write"');
    expect(issue?.message).not.toContain('"Read"');
  });

  it("a client that sends only some operations isn't blamed for the others", () => {
    const d = doc()
      .node("client", "web-client", { config: { operations: ["read"] } })
      .node("api", "api-server", { flows: { read: [] } })
      .edge("client", "api")
      .build();
    expect(has(d, "OPERATION_UNROUTABLE")).toBe(false);
    expect(issuesOf(d).find((i) => i.code === "OPERATION_NOT_SENT")?.message).toContain("Write");
  });

  it("NO_CLIENT when there are components but no client", () => {
    expect(has(doc().node("api", "api-server").build(), "NO_CLIENT")).toBe(true);
  });

  it("SERVICE_MISSING_FLOW when a distributor routes around a service", () => {
    const d = doc()
      .node("client", "web-client")
      .node("lb", "load-balancer")
      .node("a", "api-server", { flows: { read: [], write: [] } })
      .node("b", "api-server", { flows: { read: [] } })
      .edge("client", "lb")
      .edge("lb", "a")
      .edge("lb", "b")
      .build();
    const issue = issuesOf(d).find((i) => i.code === "SERVICE_MISSING_FLOW");
    expect(issue).toMatchObject({
      severity: "warning",
      nodeIds: ["b"],
      message: expect.stringContaining('"Write"'),
    });
  });

  it("routes through CDNs and gateways", () => {
    const d = doc()
      .node("client", "web-client")
      .node("cdn", "cdn")
      .node("gw", "api-gateway")
      .node("api", "api-server", { flows: { read: [], write: [] } })
      .edge("client", "cdn")
      .edge("cdn", "gw")
      .edge("gw", "api")
      .build();
    expect(issuesOf(d)).toEqual([]);
  });
});

describe("unused connections, messaging and isolation", () => {
  it("UNUSED_CONNECTION from a service when no flow uses it", () => {
    const d = validDesign().node("db2", "nosql-database").edge("api", "db2").build();
    expect(issuesOf(d).find((i) => i.code === "UNUSED_CONNECTION")?.edgeIds).toEqual(["api-db2"]);
  });

  it("UNUSED_CONNECTION into a service with no flows", () => {
    const d = validDesign().node("api2", "api-server").edge("lb", "api2").build();
    expect(
      issuesOf(d)
        .filter((i) => i.code === "UNUSED_CONNECTION")
        .map((i) => i.edgeIds),
    ).toEqual([["lb-api2"]]);
  });

  it("WORKER_NO_INBOUND", () => {
    const d = validDesign()
      .node("w2", "background-worker", { flows: { write: [] } })
      .edge("w2", "db", "w2-db")
      .build();
    expect(has(d, "WORKER_NO_INBOUND")).toBe(true);
  });

  it("QUEUE_NO_CONSUMER when messages are published but nothing consumes", () => {
    const d = validDesign().build();
    d.edges = d.edges.filter((e) => e.id !== "queue-worker");
    expect(has(d, "QUEUE_NO_CONSUMER")).toBe(true);
  });

  it("CONSUMER_MISSING_FLOW when a worker can't handle the published message", () => {
    const d = validDesign().build();
    const api = d.nodes.find((n) => n.id === "api")! as { flows: Record<string, unknown> };
    api.flows.write = [call("api-db"), publish("api-queue", { message: "read" })];
    expect(issuesOf(d).find((i) => i.code === "CONSUMER_MISSING_FLOW")?.message).toContain('"Read"');
  });

  it("event streams are brokers too", () => {
    const d = doc()
      .node("client", "web-client")
      .node("api", "api-server", { flows: { read: [], write: [publish("api-stream")] } })
      .node("stream", "event-stream")
      .node("worker", "background-worker", { flows: { write: [] } })
      .edge("client", "api")
      .edge("api", "stream")
      .edge("stream", "worker")
      .build();
    expect(issuesOf(d)).toEqual([]);
  });

  it("ISOLATED_NODE", () => {
    const d = validDesign().node("lonely", "redis-cache").build();
    expect(issuesOf(d).find((i) => i.code === "ISOLATED_NODE")?.nodeIds).toEqual(["lonely"]);
  });

  it("STORE_UNUSED for a connected store no flow calls", () => {
    const d = validDesign().node("db2", "nosql-database").edge("api", "db2").build();
    expect(issuesOf(d).find((i) => i.code === "STORE_UNUSED")?.nodeIds).toEqual(["db2"]);
  });
});

describe("cycles and evaluation order", () => {
  it("CYCLE through service calls", () => {
    const d = doc()
      .node("client", "web-client")
      .node("a", "api-server", { flows: { read: [call("a-b")], write: [] } })
      .node("b", "api-server", { flows: { read: [call("b-a")] } })
      .edge("client", "a")
      .edge("a", "b")
      .edge("b", "a")
      .build();
    const issue = issuesOf(d).find((i) => i.code === "CYCLE");
    expect(issue?.message).toMatch(/a → b → a|b → a → b/);
    expect(evaluationOrder(d)).toBeNull();
  });

  it("unused connections don't create cycles", () => {
    const d = doc()
      .node("client", "web-client")
      .node("a", "api-server", { flows: { read: [call("a-b")], write: [] } })
      .node("b", "api-server", { flows: { read: [] } })
      .edge("client", "a")
      .edge("a", "b")
      .edge("b", "a")
      .build();
    expect(has(d, "CYCLE")).toBe(false);
    expect(evaluationOrder(d)).toEqual(["client", "a", "b"]);
  });

  it("CYCLE between distributors", () => {
    const d = doc()
      .node("client", "web-client")
      .node("lb1", "load-balancer")
      .node("lb2", "load-balancer")
      .node("api", "api-server", { flows: { read: [], write: [] } })
      .edge("client", "lb1")
      .edge("lb1", "lb2")
      .edge("lb2", "lb1")
      .edge("lb2", "api")
      .build();
    expect(has(d, "CYCLE")).toBe(true);
  });

  it("orders a cache before the stores behind its miss path", () => {
    const order = evaluationOrder(validDesign().build())!;
    expect(order.indexOf("cache")).toBeLessThan(order.indexOf("db"));
    expect(order.indexOf("client")).toBe(0);
    expect(order).toHaveLength(7);
  });

  it("is not reported while other errors exist", () => {
    const d = doc()
      .node("a", "api-server", { flows: { read: [call("a-b")] } })
      .node("b", "api-server", { flows: { read: [call("b-a")] } })
      .edge("a", "b")
      .edge("b", "a")
      .build();
    d.operations = d.operations.map((o) => ({ ...o, share: 0 }));
    expect(has(d, "CYCLE")).toBe(false);
  });
});
