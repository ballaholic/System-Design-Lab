// Everything about a (document, scenario) pair that doesn't depend on traffic: validation, evaluation
// order, effective capacities and routing capability. Prepared once and reused across a sweep.

import {
  type ArchEdge,
  type ArchitectureDocument,
  type ArchNode,
  buildGraph,
  CATALOG,
  type ComponentRole,
  evaluationOrder,
  flowsOf,
  type Graph,
  hasBlockingIssues,
  type NodeId,
  type OperationId,
  type OperationKind,
  roleOf,
  validateArchitecture,
  type ValidationIssue,
} from "@sdl/architecture";
import { normalizeScenario } from "./failures";
import type { Failure, FailureScenario, Resource } from "./types";

export type Capacity = Partial<Record<Resource, number>>;

/** Normalized config: catalog defaults overlaid with the node's own values. */
type Config = Record<string, number | string[] | undefined>;

export interface Model {
  doc: ArchitectureDocument;
  g: Graph;
  order: NodeId[];
  failures: Failure[];
  role: Map<NodeId, ComponentRole>;
  config: Map<NodeId, Config>;
  capacity: Map<NodeId, Capacity>;
  /** Healthy instances that can actually work (workers on a stream are capped by its partitions). */
  usableInstances: Map<NodeId, number>;
  opKind: Map<OperationId, OperationKind>;
  canServe(id: NodeId, op: OperationId): boolean;
  routableTargets(id: NodeId, op: OperationId): ArchEdge[];
  consumersFor(brokerId: NodeId, message: OperationId): ArchEdge[];
  /** CDN: whether it may serve this operation from its cache. */
  cacheable(cdnId: NodeId, op: OperationId): boolean;
  isDown(id: NodeId): boolean;
}

export type Prepared =
  { ok: true; model: Model; issues: ValidationIssue[] } | { ok: false; issues: ValidationIssue[] };

export function prepare(doc: ArchitectureDocument, scenario: FailureScenario | undefined): Prepared {
  const scenarioCheck = normalizeScenario(doc, scenario);
  const issues = [...validateArchitecture(doc), ...scenarioCheck.issues];
  const g = buildGraph(doc);
  const order = hasBlockingIssues(issues) ? null : evaluationOrder(doc, g);
  if (!order) return { ok: false, issues };

  const role = new Map(doc.nodes.map((n) => [n.id, roleOf(n.type)]));
  const config = new Map(
    doc.nodes.map((n) => [n.id, { ...CATALOG[n.type].defaults, ...n.config } as Config]),
  );
  const failures = scenarioCheck.failures;
  const usableInstances = new Map<NodeId, number>();
  const capacity = new Map(
    doc.nodes.map((n) => [
      n.id,
      effectiveCapacity(n, config.get(n.id)!, failures, g, config, usableInstances),
    ]),
  );
  const isDown = (id: NodeId) => Object.values(capacity.get(id) ?? {}).every((c) => c === 0);

  const serveMemo = new Map<string, boolean>();
  const canServe = (id: NodeId, op: OperationId): boolean => {
    const key = `${id}\u0000${op}`;
    const cached = serveMemo.get(key);
    if (cached !== undefined) return cached;
    serveMemo.set(key, false); // the evaluation graph is acyclic, but guard anyway
    let result = false;
    if (!isDown(id)) {
      const r = role.get(id);
      if (r === "service") result = Object.hasOwn(flowsOf(g.nodes.get(id)!), op);
      else if (r === "distributor" || r === "edge-cache") result = routableTargets(id, op).length > 0;
    }
    serveMemo.set(key, result);
    return result;
  };
  const routableTargets = (id: NodeId, op: OperationId) =>
    (g.outgoing.get(id) ?? []).filter((e) => canServe(e.target, op));

  const consumersFor = (brokerId: NodeId, message: OperationId) =>
    (g.outgoing.get(brokerId) ?? []).filter(
      (e) => role.get(e.target) === "consumer" && Object.hasOwn(flowsOf(g.nodes.get(e.target)!), message),
    );

  const opKind = new Map(doc.operations.map((o) => [o.id, o.kind]));
  const cacheable = (cdnId: NodeId, op: OperationId) => {
    const list = config.get(cdnId)?.cacheableOperations as string[] | undefined;
    return list ? list.includes(op) : opKind.get(op) === "read";
  };

  return {
    ok: true,
    issues,
    model: {
      doc,
      g,
      order,
      failures,
      role,
      config,
      capacity,
      usableInstances,
      opKind,
      canServe,
      routableTargets,
      consumersFor,
      cacheable,
      isDown,
    },
  };
}

function effectiveCapacity(
  node: ArchNode,
  config: Config,
  failures: Failure[],
  g: Graph,
  configs: Map<NodeId, Config>,
  usableInstances: Map<NodeId, number>,
): Capacity {
  const mine = failures.filter((f) => f.nodeId === node.id);
  const has = (kind: Failure["kind"]) => mine.some((f) => f.kind === kind);
  const num = (key: string) => config[key] as number;

  switch (roleOf(node.type)) {
    case "source":
      return { total: Infinity };
    case "distributor": {
      const limit = config.rateLimitRps as number | undefined;
      return { total: limit === undefined ? num("capacityRps") : Math.min(num("capacityRps"), limit) };
    }
    case "edge-cache":
      return { total: num("capacityRps") };
    case "service": {
      const failed = mine.reduce((n, f) => n + (f.kind === "app-instance-failure" ? f.count : 0), 0);
      const healthy = Math.max(0, num("instances") - failed);
      usableInstances.set(node.id, healthy);
      return { total: healthy * num("capacityPerInstanceRps") };
    }
    case "consumer": {
      let instances = has("worker-down") ? 0 : num("instances");
      // A consumer group can't use more instances than the stream has partitions.
      for (const e of g.incoming.get(node.id) ?? []) {
        const source = g.nodes.get(e.source);
        if (source && roleOf(source.type) === "stream") {
          instances = Math.min(instances, configs.get(source.id)!.partitions as number);
        }
      }
      usableInstances.set(node.id, instances);
      return { total: instances * num("throughputPerInstance") };
    }
    case "cache":
      return { total: has("cache-down") ? 0 : num("capacityOps") };
    case "store":
      return has("database-primary-down")
        ? { read: 0, write: 0 }
        : { read: num("readCapacity"), write: num("writeCapacity") };
    case "queue":
      return { total: num("enqueueCapacity") };
    case "stream":
      return { total: num("ingestCapacity") };
  }
}
