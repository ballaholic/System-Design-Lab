// Structural, connection and flow validation plus the evaluation order (ARCHITECTURE §6.5–6.6).

import { CAN_TARGET, HAS_FLOWS, ROLE } from "./catalog.js";
import type { ArchEdge, ArchitectureDocument, ArchNode, EdgeId, FlowStep, NodeId, ValidationIssue } from "./model.js";

const MAX_NESTING = 3;

export interface Graph {
  nodes: Map<NodeId, ArchNode>;
  edges: Map<EdgeId, ArchEdge>;
  outgoing: Map<NodeId, ArchEdge[]>;
}

export function buildGraph(doc: ArchitectureDocument): Graph {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const edges = new Map(doc.edges.map((e) => [e.id, e]));
  const outgoing = new Map<NodeId, ArchEdge[]>(doc.nodes.map((n) => [n.id, []]));
  for (const e of doc.edges) outgoing.get(e.source)?.push(e);
  return { nodes, edges, outgoing };
}

export function flowsOf(node: ArchNode) {
  return node.type === "api-server" || node.type === "background-worker" ? node.flows ?? {} : {};
}

export function validate(doc: ArchitectureDocument): { issues: ValidationIssue[]; order: NodeId[] | null } {
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string, ids: { nodeIds?: NodeId[]; edgeIds?: EdgeId[] } = {}) =>
    issues.push({ code, severity: "error", message, ...ids });
  const warn = (code: string, message: string, ids: { nodeIds?: NodeId[]; edgeIds?: EdgeId[] } = {}) =>
    issues.push({ code, severity: "warning", message, ...ids });

  checkUnique(doc.nodes.map((n) => n.id), "DUPLICATE_NODE_ID", error);
  checkUnique(doc.edges.map((e) => e.id), "DUPLICATE_EDGE_ID", error);
  checkUnique(doc.operations.map((o) => o.id), "DUPLICATE_OPERATION_ID", error);
  if (doc.operations.length === 0) error("NO_OPERATIONS", "Define at least one operation.");
  // share 0 marks an internal or message-only operation (never sent by clients).
  for (const op of doc.operations) {
    if (!(op.share >= 0)) error("INVALID_SHARE", `Operation "${op.name}" needs a share of 0 or more.`);
  }
  if (doc.operations.length > 0 && !doc.operations.some((o) => o.share > 0)) {
    error("NO_CLIENT_TRAFFIC", "At least one operation needs a share greater than 0.");
  }

  const g = buildGraph(doc);
  const opIds = new Set(doc.operations.map((o) => o.id));

  for (const e of doc.edges) {
    const s = g.nodes.get(e.source);
    const t = g.nodes.get(e.target);
    if (!s || !t) {
      error("DANGLING_EDGE", `Connection ${e.id} references a missing component.`, { edgeIds: [e.id] });
      continue;
    }
    if (!CAN_TARGET[s.type].includes(t.type)) {
      error("INVALID_CONNECTION", `"${s.label}" (${s.type}) cannot connect to "${t.label}" (${t.type}).`, {
        edgeIds: [e.id],
      });
    }
  }

  const usedEdges = new Set<EdgeId>();
  for (const node of doc.nodes) {
    const flows = flowsOf(node);
    if (!HAS_FLOWS.has(ROLE[node.type]) && "flows" in node && node.flows) {
      error("FLOWS_ON_NON_SERVICE", `Only services and workers have flows ("${node.label}").`, { nodeIds: [node.id] });
    }
    for (const [opId, steps] of Object.entries(flows)) {
      if (!opIds.has(opId)) {
        error("UNKNOWN_OPERATION", `"${node.label}" has a flow for unknown operation "${opId}".`, { nodeIds: [node.id] });
      }
      checkSteps(node, steps, opId, 1);
    }
  }

  function checkSteps(node: ArchNode, steps: FlowStep[], opId: string, depth: number) {
    if (depth > MAX_NESTING) {
      error("NESTING_TOO_DEEP", `Flow "${opId}" on "${node.label}" nests deeper than ${MAX_NESTING}.`, { nodeIds: [node.id] });
      return;
    }
    for (const step of steps) {
      const edge = g.edges.get(step.edge);
      if (!edge || edge.source !== node.id) {
        error("STEP_EDGE_INVALID", `A step in "${opId}" on "${node.label}" uses a connection that does not start there.`, {
          nodeIds: [node.id],
        });
        continue;
      }
      usedEdges.add(edge.id);
      const target = g.nodes.get(edge.target);
      if (!target) continue;
      const role = ROLE[target.type];
      if (step.type === "cache-lookup") {
        if (role !== "cache") error("LOOKUP_TARGET", `cache-lookup must target a cache, not "${target.label}".`, { edgeIds: [edge.id] });
        for (const t of subtreeTargets(g, step.onMiss)) {
          if (t === target.id) error("LOOKUP_SELF", `On-miss steps cannot call the cache being looked up; use "populate".`, { edgeIds: [edge.id] });
        }
        checkSteps(node, step.onMiss, opId, depth + 1);
      } else if (step.type === "publish") {
        if (role !== "queue") error("PUBLISH_TARGET", `publish must target a queue, not "${target.label}".`, { edgeIds: [edge.id] });
        const msg = step.message ?? opId;
        if (!opIds.has(msg)) error("UNKNOWN_OPERATION", `publish uses unknown message operation "${msg}".`, { edgeIds: [edge.id] });
      } else {
        if (role === "queue" || role === "consumer" || role === "source") {
          error("CALL_TARGET", `call cannot target "${target.label}"; use publish for queues.`, { edgeIds: [edge.id] });
        }
        const targetOp = step.operation ?? opId;
        if (!opIds.has(targetOp)) error("UNKNOWN_OPERATION", `call uses unknown operation "${targetOp}".`, { edgeIds: [edge.id] });
        if (role === "service" && !(targetOp in flowsOf(target))) {
          error("CALL_TARGET_NO_FLOW", `"${target.label}" has no flow for "${targetOp}".`, { nodeIds: [target.id] });
        }
      }
    }
  }

  // Connections out of services/workers carry traffic only through flow steps.
  for (const e of doc.edges) {
    const s = g.nodes.get(e.source);
    if (s && HAS_FLOWS.has(ROLE[s.type]) && !usedEdges.has(e.id)) {
      warn("UNUSED_CONNECTION", `Connection from "${s.label}" carries no traffic: no flow uses it.`, { edgeIds: [e.id] });
    }
  }

  // Operations no client issues.
  const issued = new Set<string>();
  for (const n of doc.nodes) {
    if (ROLE[n.type] === "source") {
      const ops = (n.config as { operations?: string[] }).operations ?? [...opIds];
      ops.forEach((o) => issued.add(o));
    }
  }
  for (const op of doc.operations) {
    if (op.share > 0 && !issued.has(op.id)) warn("OPERATION_NOT_ISSUED", `No client sends "${op.name}".`);
  }

  if (issues.some((i) => i.severity === "error")) return { issues, order: null };

  const order = evaluationOrder(doc, g);
  if (!order) {
    error("CYCLE", "The architecture contains a cycle (including cache miss paths), which the simulator cannot evaluate.");
    return { issues, order: null };
  }
  return { issues, order };
}

/**
 * Topological order over edges plus, for every cache-lookup on cache C, C → each target in its onMiss
 * subtree, so a cache is resolved before its miss traffic reaches the components behind it.
 */
export function evaluationOrder(doc: ArchitectureDocument, g: Graph = buildGraph(doc)): NodeId[] | null {
  const deps = new Map<NodeId, Set<NodeId>>(doc.nodes.map((n) => [n.id, new Set()]));
  for (const e of doc.edges) deps.get(e.source)?.add(e.target);
  for (const node of doc.nodes) {
    for (const steps of Object.values(flowsOf(node))) addLookupDeps(steps);
  }
  function addLookupDeps(steps: FlowStep[]) {
    for (const s of steps) {
      if (s.type !== "cache-lookup") continue;
      const cache = g.edges.get(s.edge)?.target;
      if (cache) for (const t of subtreeTargets(g, s.onMiss)) deps.get(cache)?.add(t);
      addLookupDeps(s.onMiss);
    }
  }

  // Kahn's algorithm; ties broken by document order for determinism.
  const indegree = new Map<NodeId, number>(doc.nodes.map((n) => [n.id, 0]));
  for (const targets of deps.values()) for (const t of targets) indegree.set(t, (indegree.get(t) ?? 0) + 1);
  const ready = doc.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const order: NodeId[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const t of deps.get(id) ?? []) {
      const d = (indegree.get(t) ?? 0) - 1;
      indegree.set(t, d);
      if (d === 0) ready.push(t);
    }
  }
  return order.length === doc.nodes.length ? order : null;
}

function subtreeTargets(g: Graph, steps: FlowStep[]): NodeId[] {
  const out: NodeId[] = [];
  for (const s of steps) {
    const t = g.edges.get(s.edge)?.target;
    if (t) out.push(t);
    if (s.type === "cache-lookup") out.push(...subtreeTargets(g, s.onMiss));
  }
  return out;
}

function checkUnique(ids: string[], code: string, error: (code: string, message: string) => void) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) error(code, `Duplicate id "${id}".`);
    seen.add(id);
  }
}
