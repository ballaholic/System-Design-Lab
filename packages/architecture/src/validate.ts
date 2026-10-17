import { CATALOG, isComponentType, roleOf } from "./catalog";
import { checkConnectionTypes } from "./connections";
import {
  buildGraph,
  countSteps,
  createCapability,
  edgesUsedByFlows,
  type Graph,
  operationsSentBy,
  walkSteps,
} from "./graph";
import { LIMITS } from "./limits";
import {
  type ArchitectureDocument,
  type ArchNode,
  type EdgeId,
  type FlowStep,
  flowsOf,
  isFlowNode,
  type NodeId,
  type OperationId,
} from "./schema";

export type IssueSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  /** Stable code, e.g. "CYCLE" or "UNUSED_CONNECTION". */
  code: string;
  severity: IssueSeverity;
  /** User-facing and educational. */
  message: string;
  nodeIds?: NodeId[];
  edgeIds?: EdgeId[];
}

/**
 * Validates a schema-valid document (ARCHITECTURE §6.6, PG-7). Errors block simulation; warnings and info
 * don't. The result is deterministic: same document, same issues in the same order.
 */
export function validateArchitecture(doc: ArchitectureDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (
    severity: IssueSeverity,
    code: string,
    message: string,
    refs: Omit<ValidationIssue, "code" | "severity" | "message"> = {},
  ) => issues.push({ code, severity, message, ...refs });
  const error = add.bind(null, "error");
  const warn = add.bind(null, "warning");

  const g = buildGraph(doc);
  const opIds = new Set(doc.operations.map((o) => o.id));
  const opName = (id: OperationId) => doc.operations.find((o) => o.id === id)?.name ?? id;
  const label = (id: NodeId) => g.nodes.get(id)?.label ?? id;

  // ---- Identity and structure ----
  for (const id of duplicates(doc.nodes.map((n) => n.id))) {
    error("DUPLICATE_NODE_ID", `Two components share the id "${id}".`, { nodeIds: [id] });
  }
  for (const id of duplicates(doc.edges.map((e) => e.id))) {
    error("DUPLICATE_EDGE_ID", `Two connections share the id "${id}".`, { edgeIds: [id] });
  }
  for (const id of duplicates(doc.operations.map((o) => o.id))) {
    error("DUPLICATE_OPERATION_ID", `Two operations share the id "${id}".`);
  }
  if (!doc.operations.some((o) => o.share > 0)) {
    error("NO_CLIENT_TRAFFIC", "At least one operation needs a traffic share greater than 0.");
  }

  const pairs = new Set<string>();
  for (const e of doc.edges) {
    const s = g.nodes.get(e.source);
    const t = g.nodes.get(e.target);
    if (!s || !t) {
      error("DANGLING_EDGE", "A connection points to a component that no longer exists.", {
        edgeIds: [e.id],
      });
      continue;
    }
    if (e.source === e.target) {
      error("SELF_CONNECTION", `"${s.label}" is connected to itself.`, { edgeIds: [e.id], nodeIds: [s.id] });
      continue;
    }
    const check = checkConnectionTypes(s.type, t.type);
    if (!check.ok) error("INVALID_CONNECTION", check.reason, { edgeIds: [e.id], nodeIds: [s.id, t.id] });
    const pair = `${e.source}\u0000${e.target}`;
    if (pairs.has(pair)) {
      warn("DUPLICATE_CONNECTION", `"${s.label}" is connected to "${t.label}" more than once.`, {
        edgeIds: [e.id],
      });
    }
    pairs.add(pair);
  }

  for (const node of doc.nodes) {
    const parsed = CATALOG[node.type].configSchema.safeParse(node.config);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => fieldLabel(node, String(i.path[0] ?? ""))))];
      error("CONFIG_INVALID", `"${node.label}" has invalid settings: ${fields.join(", ")}.`, {
        nodeIds: [node.id],
      });
    }
    for (const key of ["operations", "cacheableOperations"] as const) {
      const list = (node.config as Record<string, unknown>)[key];
      if (Array.isArray(list) && list.some((id) => !opIds.has(id as string))) {
        warn("UNKNOWN_OPERATION_REFERENCE", `"${node.label}" refers to an operation that no longer exists.`, {
          nodeIds: [node.id],
        });
      }
    }
  }

  // ---- Flows ----
  const canHandle = createCapability(doc, g);
  const publishedTo = new Map<NodeId, Set<OperationId>>(); // broker -> message operations

  for (const node of doc.nodes) {
    if (!isFlowNode(node)) continue;
    for (const [opId, steps] of Object.entries(flowsOf(node))) {
      if (!opIds.has(opId)) {
        error(
          "FLOW_UNKNOWN_OPERATION",
          `"${node.label}" has a flow for an operation that no longer exists ("${opId}").`,
          {
            nodeIds: [node.id],
          },
        );
        continue;
      }
      if (countSteps(steps) > LIMITS.stepsPerFlow) {
        error(
          "FLOW_TOO_LONG",
          `The "${opName(opId)}" flow on "${node.label}" has more than ${LIMITS.stepsPerFlow} steps.`,
          {
            nodeIds: [node.id],
          },
        );
      }
      checkSteps(node, opId, steps);
    }
  }

  function checkSteps(node: ArchNode, opId: OperationId, steps: readonly FlowStep[]) {
    const where = `the "${opName(opId)}" flow on "${node.label}"`;
    for (const step of steps) {
      const edge = g.edges.get(step.edge);
      if (!edge || edge.source !== node.id) {
        error(
          "STEP_EDGE_INVALID",
          `A step in ${where} uses a connection that doesn't start at "${node.label}".`,
          {
            nodeIds: [node.id],
          },
        );
        if (step.type === "cache-lookup") checkSteps(node, opId, step.onMiss);
        continue;
      }
      const target = g.nodes.get(edge.target);
      if (!target) continue; // reported as DANGLING_EDGE
      const role = roleOf(target.type);
      const refs = { nodeIds: [node.id], edgeIds: [edge.id] };

      if (step.type === "cache-lookup") {
        if (role !== "cache") {
          error("LOOKUP_TARGET", `A cache lookup in ${where} must use a cache, not "${target.label}".`, refs);
        }
        const missTargets = new Set<NodeId>();
        walkSteps(step.onMiss, (s) => {
          const t = g.edges.get(s.edge)?.target;
          if (t) missTargets.add(t);
        });
        if (missTargets.has(target.id)) {
          error(
            "LOOKUP_SELF",
            `On-miss steps in ${where} call the cache being looked up. Turn on "populate" instead to fill the cache on a miss.`,
            refs,
          );
        }
        checkSteps(node, opId, step.onMiss);
      } else if (step.type === "publish") {
        if (role !== "queue" && role !== "stream") {
          error(
            "PUBLISH_TARGET",
            `A publish step in ${where} must use a message queue or event stream, not "${target.label}".`,
            refs,
          );
        }
        const message = step.message ?? opId;
        if (!opIds.has(message)) {
          error(
            "STEP_UNKNOWN_OPERATION",
            `A publish step in ${where} sends an operation that no longer exists.`,
            refs,
          );
        } else if (role === "queue" || role === "stream") {
          let set = publishedTo.get(target.id);
          if (!set) publishedTo.set(target.id, (set = new Set()));
          set.add(message);
        }
      } else {
        if (role === "queue" || role === "stream") {
          error(
            "CALL_TARGET",
            `${capitalize(where)} calls "${target.label}". Use a publish step for queues and streams.`,
            refs,
          );
          continue;
        }
        const targetOp = step.operation ?? opId;
        if (!opIds.has(targetOp)) {
          error(
            "STEP_UNKNOWN_OPERATION",
            `A call in ${where} uses an operation that no longer exists.`,
            refs,
          );
        } else if ((role === "service" || role === "distributor") && !canHandle(target.id, targetOp)) {
          error(
            "CALL_TARGET_NO_FLOW",
            role === "service"
              ? `${capitalize(where)} calls "${target.label}" with "${opName(targetOp)}", but "${target.label}" has no flow for it.`
              : `${capitalize(where)} calls "${target.label}" with "${opName(targetOp)}", but nothing behind it handles that operation.`,
            refs,
          );
        }
      }
    }
  }

  // ---- Routing from clients ----
  const sources = doc.nodes.filter((n) => roleOf(n.type) === "source");
  const sent = new Set<OperationId>();
  for (const client of sources) {
    const ops = operationsSentBy(client, doc).filter(
      (id) => opIds.has(id) && (doc.operations.find((o) => o.id === id)?.share ?? 0) > 0,
    );
    ops.forEach((id) => sent.add(id));
    const targets = g.outgoing.get(client.id) ?? [];
    const unroutable = ops.filter((op) => !targets.some((e) => canHandle(e.target, op)));
    if (unroutable.length > 0) {
      error(
        "OPERATION_UNROUTABLE",
        targets.length === 0
          ? `"${client.label}" isn't connected to anything. Connect it to a load balancer, gateway or API server.`
          : `Nothing reachable from "${client.label}" handles ${list(unroutable.map(opName))}. Add a flow for it on an API server behind this client.`,
        { nodeIds: [client.id] },
      );
    }
  }
  if (doc.nodes.length > 0 && sources.length === 0) {
    warn("NO_CLIENT", "Traffic starts at clients. Add a web or mobile client.");
  } else if (sources.length > 0) {
    for (const op of doc.operations) {
      if (op.share > 0 && !sent.has(op.id)) {
        warn("OPERATION_NOT_SENT", `No client sends "${op.name}", so it gets no traffic.`);
      }
    }
  }

  // Services that a client or distributor routes an operation to, but which have no flow for it.
  const arriving = arrivingOperations(doc, g);
  for (const node of doc.nodes) {
    const role = roleOf(node.type);
    if (role !== "source" && role !== "distributor" && role !== "edge-cache") continue;
    const ops = arriving.get(node.id) ?? new Set<OperationId>();
    for (const e of g.outgoing.get(node.id) ?? []) {
      const target = g.nodes.get(e.target);
      if (!target || roleOf(target.type) !== "service") continue;
      const missing = [...ops].filter((op) => !canHandle(target.id, op));
      if (missing.length > 0) {
        warn(
          "SERVICE_MISSING_FLOW",
          `"${target.label}" has no flow for ${list(missing.map(opName))}, so "${node.label}" won't send it those requests.`,
          { nodeIds: [target.id], edgeIds: [e.id] },
        );
      }
    }
  }

  // ---- Connections that carry nothing ----
  const used = edgesUsedByFlows(doc);
  for (const e of doc.edges) {
    const s = g.nodes.get(e.source);
    const t = g.nodes.get(e.target);
    if (!s || !t || e.source === e.target) continue;
    const role = roleOf(s.type);
    if (isFlowNode(s) && !used.has(e.id)) {
      warn(
        "UNUSED_CONNECTION",
        `The connection from "${s.label}" to "${t.label}" carries no traffic: no flow on "${s.label}" uses it.`,
        {
          edgeIds: [e.id],
        },
      );
    } else if (
      (role === "source" || role === "distributor" || role === "edge-cache") &&
      roleOf(t.type) === "service"
    ) {
      if (!doc.operations.some((o) => canHandle(t.id, o.id))) {
        warn(
          "UNUSED_CONNECTION",
          `The connection to "${t.label}" carries no traffic until "${t.label}" has a flow.`,
          {
            edgeIds: [e.id],
          },
        );
      }
    }
  }

  // ---- Messaging ----
  for (const node of doc.nodes) {
    const role = roleOf(node.type);
    if (role === "consumer" && !(g.incoming.get(node.id) ?? []).some((e) => isBroker(g, e.source))) {
      warn(
        "WORKER_NO_INBOUND",
        `"${node.label}" receives nothing. Connect a message queue or event stream to it.`,
        {
          nodeIds: [node.id],
        },
      );
    }
    if (role === "queue" || role === "stream") {
      const consumers = (g.outgoing.get(node.id) ?? []).filter((e) => {
        const target = g.nodes.get(e.target);
        return target !== undefined && roleOf(target.type) === "consumer";
      });
      const messages = publishedTo.get(node.id) ?? new Set<OperationId>();
      if (consumers.length === 0 && messages.size > 0) {
        warn(
          "QUEUE_NO_CONSUMER",
          `Messages published to "${node.label}" pile up: no background worker consumes them.`,
          {
            nodeIds: [node.id],
          },
        );
      }
      for (const e of consumers) {
        const worker = g.nodes.get(e.target)!;
        const missing = [...messages].filter((m) => !Object.hasOwn(flowsOf(worker), m));
        if (missing.length > 0) {
          warn(
            "CONSUMER_MISSING_FLOW",
            `"${worker.label}" has no flow for ${list(missing.map(opName))} published to "${node.label}".`,
            {
              nodeIds: [worker.id],
              edgeIds: [e.id],
            },
          );
        }
      }
    }
  }

  // ---- Isolated and unused components ----
  const stepTargets = new Set(
    [...used].map((id) => g.edges.get(id)?.target).filter((id): id is NodeId => !!id),
  );
  for (const node of doc.nodes) {
    const degree = (g.incoming.get(node.id)?.length ?? 0) + (g.outgoing.get(node.id)?.length ?? 0);
    const role = roleOf(node.type);
    if (degree === 0 && role !== "source") {
      warn("ISOLATED_NODE", `"${node.label}" isn't connected to anything.`, { nodeIds: [node.id] });
    } else if (degree > 0 && (role === "store" || role === "cache") && !stepTargets.has(node.id)) {
      warn("STORE_UNUSED", `No flow uses "${node.label}". Add a step that calls it, or remove it.`, {
        nodeIds: [node.id],
      });
    }
  }

  // ---- Cycles (only when everything else is consistent) ----
  if (!issues.some((i) => i.severity === "error")) {
    const cycle = findCycle(doc, g);
    if (cycle) {
      error(
        "CYCLE",
        `Requests can loop: ${[...cycle, cycle[0]!].map(label).join(" → ")}. The simulator needs traffic to flow one way.`,
        { nodeIds: cycle },
      );
    }
  }

  return issues;
}

export function hasBlockingIssues(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/**
 * Dependencies the simulator follows: connections that carry traffic (all connections out of clients,
 * distributors, CDNs and brokers; connections out of services only when a flow uses them), plus, for every
 * cache lookup on cache C, C → each component in its on-miss steps, so the cache is resolved first.
 */
export function evaluationDependencies(
  doc: ArchitectureDocument,
  g: Graph = buildGraph(doc),
): Map<NodeId, NodeId[]> {
  const used = edgesUsedByFlows(doc);
  const deps = new Map<NodeId, Set<NodeId>>(doc.nodes.map((n) => [n.id, new Set()]));
  for (const e of doc.edges) {
    const s = g.nodes.get(e.source);
    if (!s || !g.nodes.has(e.target)) continue;
    if (!isFlowNode(s) || used.has(e.id)) deps.get(e.source)!.add(e.target);
  }
  for (const node of doc.nodes) {
    for (const steps of Object.values(flowsOf(node))) {
      walkSteps(steps, (step) => {
        if (step.type !== "cache-lookup") return;
        const cache = g.edges.get(step.edge)?.target;
        if (!cache || !deps.has(cache)) return;
        walkSteps(step.onMiss, (s) => {
          const t = g.edges.get(s.edge)?.target;
          if (t && t !== cache && deps.has(t)) deps.get(cache)!.add(t);
        });
      });
    }
  }
  return new Map([...deps].map(([k, v]) => [k, [...v]]));
}

/** Topological order of the evaluation graph, ties broken by document order; null if there's a cycle. */
export function evaluationOrder(doc: ArchitectureDocument, g: Graph = buildGraph(doc)): NodeId[] | null {
  const deps = evaluationDependencies(doc, g);
  const indegree = new Map<NodeId, number>(doc.nodes.map((n) => [n.id, 0]));
  for (const targets of deps.values()) for (const t of targets) indegree.set(t, indegree.get(t)! + 1);
  const ready = doc.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const order: NodeId[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const t of deps.get(id) ?? []) {
      const d = indegree.get(t)! - 1;
      indegree.set(t, d);
      if (d === 0) ready.push(t);
    }
  }
  return order.length === doc.nodes.length ? order : null;
}

function findCycle(doc: ArchitectureDocument, g: Graph): NodeId[] | null {
  const deps = evaluationDependencies(doc, g);
  const state = new Map<NodeId, "visiting" | "done">();
  const stack: NodeId[] = [];
  const visit = (id: NodeId): NodeId[] | null => {
    state.set(id, "visiting");
    stack.push(id);
    for (const next of deps.get(id) ?? []) {
      if (state.get(next) === "visiting") return stack.slice(stack.indexOf(next));
      if (!state.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };
  for (const node of doc.nodes) {
    if (!state.has(node.id)) {
      const found = visit(node.id);
      if (found) return found;
    }
  }
  return null;
}

/** Operations that reach each client, distributor and CDN through distribution (not through flow calls). */
function arrivingOperations(doc: ArchitectureDocument, g: Graph): Map<NodeId, Set<OperationId>> {
  const canHandle = createCapability(doc, g);
  const arriving = new Map<NodeId, Set<OperationId>>();
  const queue: NodeId[] = [];
  for (const node of doc.nodes) {
    if (roleOf(node.type) !== "source") continue;
    const ops = operationsSentBy(node, doc).filter(
      (op) => (doc.operations.find((o) => o.id === op)?.share ?? 0) > 0,
    );
    arriving.set(node.id, new Set(ops));
    queue.push(node.id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const ops = arriving.get(id)!;
    for (const e of g.outgoing.get(id) ?? []) {
      const target = g.nodes.get(e.target);
      const role = target && roleOf(target.type);
      if (!target || (role !== "distributor" && role !== "edge-cache")) continue;
      let set = arriving.get(target.id);
      if (!set) arriving.set(target.id, (set = new Set()));
      let grew = false;
      for (const op of ops) {
        // A distributor only forwards operations that something behind it can handle.
        if (!set.has(op) && canHandle(target.id, op)) {
          set.add(op);
          grew = true;
        }
      }
      if (grew) queue.push(target.id);
    }
  }
  return arriving;
}

function isBroker(g: Graph, id: NodeId): boolean {
  const node = g.nodes.get(id);
  const role = node && roleOf(node.type);
  return role === "queue" || role === "stream";
}

function fieldLabel(node: ArchNode, key: string): string {
  if (!isComponentType(node.type)) return key;
  return CATALOG[node.type].fields.find((f) => f.key === key)?.meta.label ?? key;
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) (seen.has(id) ? dupes : seen).add(id);
  return [...dupes];
}

function list(items: string[]): string {
  const quoted = items.map((i) => `"${i}"`);
  return quoted.length <= 1 ? (quoted[0] ?? "") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

function capitalize(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1);
}
