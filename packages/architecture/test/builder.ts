import {
  type ArchitectureDocument,
  type ArchNode,
  CATALOG,
  type ComponentType,
  type FlowStep,
  type Flows,
  type Operation,
  type ValidationIssue,
} from "../src";

/** Terse document builder for tests: `doc().node("lb", "load-balancer").edge("c", "lb").build()`. */
export function doc(operations: Operation[] = defaultOperations()) {
  const d: ArchitectureDocument = { schemaVersion: 1, operations, nodes: [], edges: [], layout: {} };
  const api = {
    node(
      id: string,
      type: ComponentType,
      options: { config?: Record<string, unknown>; flows?: Flows; label?: string } = {},
    ) {
      const n = {
        id,
        type,
        label: options.label ?? id,
        config: { ...CATALOG[type].defaults, ...options.config },
        ...(options.flows ? { flows: options.flows } : {}),
      } as ArchNode;
      d.nodes.push(n);
      d.layout[id] = { x: d.nodes.length * 100, y: 0 };
      return api;
    },
    /** Edge id defaults to `source-target`. */
    edge(source: string, target: string, id = `${source}-${target}`) {
      d.edges.push({ id, source, target });
      return api;
    },
    build: () => d,
  };
  return api;
}

export function defaultOperations(): Operation[] {
  return [
    { id: "read", name: "Read", kind: "read", share: 9 },
    { id: "write", name: "Write", kind: "write", share: 1 },
  ];
}

export const call = (edge: string, extra: Partial<Extract<FlowStep, { type: "call" }>> = {}): FlowStep => ({
  type: "call",
  edge,
  ...extra,
});
export const publish = (
  edge: string,
  extra: Partial<Extract<FlowStep, { type: "publish" }>> = {},
): FlowStep => ({
  type: "publish",
  edge,
  ...extra,
});
export const lookup = (edge: string, onMiss: FlowStep[] = [], populate?: boolean): FlowStep => ({
  type: "cache-lookup",
  edge,
  onMiss,
  ...(populate === undefined ? {} : { populate }),
});

/**
 * A complete, valid design: client → LB → API → cache + DB, API publishes to a queue consumed by a worker
 * that writes to the DB.
 */
export function validDesign() {
  return doc()
    .node("client", "web-client")
    .node("lb", "load-balancer")
    .node("api", "api-server", {
      flows: {
        read: [lookup("api-cache", [call("api-db")], true)],
        write: [call("api-db"), call("api-cache", { as: "write", optional: true }), publish("api-queue")],
      },
    })
    .node("cache", "redis-cache")
    .node("db", "sql-database")
    .node("queue", "message-queue")
    .node("worker", "background-worker", { flows: { write: [call("worker-db", { as: "write" })] } })
    .edge("client", "lb")
    .edge("lb", "api")
    .edge("api", "cache")
    .edge("api", "db")
    .edge("api", "queue")
    .edge("queue", "worker")
    .edge("worker", "db");
}

export const codes = (issues: ValidationIssue[]) => issues.map((i) => i.code);
