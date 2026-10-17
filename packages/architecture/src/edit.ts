import { CATALOG, type ComponentType, roleOf } from "./catalog";
import { walkSteps } from "./graph";
import { createId } from "./ids";
import { LIMITS } from "./limits";
import {
  type ArchEdge,
  type ArchitectureDocument,
  type ArchNode,
  CURRENT_SCHEMA_VERSION,
  type EdgeId,
  type FlowStep,
  type Flows,
  flowsOf,
  isFlowNode,
  type NodeId,
  type OperationId,
  type Position,
} from "./schema";

// Pure, immutable editing operations. The editor store records each result as one history entry, so a cascade
// (for example deleting an edge and the flow steps that use it) undoes in one step (ADR-014).

export function createEmptyDocument(): ArchitectureDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    operations: [
      { id: "read", name: "Read", kind: "read", share: 9 },
      { id: "write", name: "Write", kind: "write", share: 1 },
    ],
    nodes: [],
    edges: [],
    layout: {},
  };
}

/** A new node with default config and a label that's unique in the document ("API server 2"). */
export function createNode(
  doc: ArchitectureDocument,
  type: ComponentType,
  id: NodeId = createId("n"),
): ArchNode {
  const def = CATALOG[type];
  return { id, type, label: uniqueLabel(doc, def.name), config: structuredClone(def.defaults) } as ArchNode;
}

export function addNode(doc: ArchitectureDocument, node: ArchNode, position: Position): ArchitectureDocument {
  return { ...doc, nodes: [...doc.nodes, node], layout: { ...doc.layout, [node.id]: position } };
}

export function addEdge(
  doc: ArchitectureDocument,
  source: NodeId,
  target: NodeId,
  id: EdgeId = createId("e"),
): {
  doc: ArchitectureDocument;
  edge: ArchEdge;
} {
  const edge: ArchEdge = { id, source, target };
  return { doc: { ...doc, edges: [...doc.edges, edge] }, edge };
}

export function updateNode(
  doc: ArchitectureDocument,
  id: NodeId,
  update: (node: ArchNode) => ArchNode,
): ArchitectureDocument {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? update(n) : n)) };
}

export function setFlow(
  doc: ArchitectureDocument,
  nodeId: NodeId,
  operation: OperationId,
  steps: FlowStep[] | null,
): ArchitectureDocument {
  return updateNode(doc, nodeId, (node) => {
    if (!isFlowNode(node)) return node;
    const flows: Flows = { ...flowsOf(node) };
    if (steps === null) delete flows[operation];
    else flows[operation] = steps;
    return { ...node, flows } as ArchNode;
  });
}

/** Flow steps (at any depth) that use one of `edgeIds`, for the "this connection is used by…" warning. */
export function flowUsages(
  doc: ArchitectureDocument,
  edgeIds: Iterable<EdgeId>,
): Array<{ nodeId: NodeId; operation: OperationId }> {
  const ids = new Set(edgeIds);
  const usages: Array<{ nodeId: NodeId; operation: OperationId }> = [];
  for (const node of doc.nodes) {
    for (const [operation, steps] of Object.entries(flowsOf(node))) {
      let uses = false;
      walkSteps(steps, (s) => {
        if (ids.has(s.edge)) uses = true;
      });
      if (uses) usages.push({ nodeId: node.id, operation });
    }
  }
  return usages;
}

/**
 * Removes edges and every step that uses them. A removed cache lookup's on-miss steps move up into its place,
 * so deleting the cache connection keeps the database calls.
 */
export function removeEdges(doc: ArchitectureDocument, edgeIds: Iterable<EdgeId>): ArchitectureDocument {
  const ids = new Set(edgeIds);
  if (ids.size === 0) return doc;
  const prune = (steps: FlowStep[]): FlowStep[] =>
    steps.flatMap((step): FlowStep[] => {
      if (step.type === "cache-lookup") {
        const onMiss = prune(step.onMiss);
        return ids.has(step.edge) ? onMiss : [{ ...step, onMiss }];
      }
      return ids.has(step.edge) ? [] : [step];
    });
  return {
    ...doc,
    edges: doc.edges.filter((e) => !ids.has(e.id)),
    nodes: doc.nodes.map((node) => {
      if (!isFlowNode(node) || !node.flows) return node;
      const flows = Object.fromEntries(
        Object.entries(flowsOf(node)).map(([op, steps]) => [op, prune(steps)]),
      );
      return { ...node, flows } as ArchNode;
    }),
  };
}

export function removeNodes(doc: ArchitectureDocument, nodeIds: Iterable<NodeId>): ArchitectureDocument {
  const ids = new Set(nodeIds);
  if (ids.size === 0) return doc;
  const withoutEdges = removeEdges(
    doc,
    doc.edges.filter((e) => ids.has(e.source) || ids.has(e.target)).map((e) => e.id),
  );
  const layout = { ...withoutEdges.layout };
  for (const id of ids) delete layout[id];
  return { ...withoutEdges, nodes: withoutEdges.nodes.filter((n) => !ids.has(n.id)), layout };
}

/**
 * Removes an operation and everything that refers to it: flows for it, step overrides (which fall back to the
 * flow's own operation), client and CDN operation lists, and the traffic mix.
 */
export function removeOperation(doc: ArchitectureDocument, operation: OperationId): ArchitectureDocument {
  const strip = (steps: FlowStep[]): FlowStep[] =>
    steps.map((step) => {
      if (step.type === "call" && step.operation === operation) {
        const { operation: _removed, ...rest } = step;
        return rest;
      }
      if (step.type === "publish" && step.message === operation) {
        const { message: _removed, ...rest } = step;
        return rest;
      }
      if (step.type === "cache-lookup") return { ...step, onMiss: strip(step.onMiss) };
      return step;
    });

  const nodes = doc.nodes.map((node): ArchNode => {
    let next = node;
    const config = node.config as Record<string, unknown>;
    for (const key of ["operations", "cacheableOperations"]) {
      const list = config[key];
      if (Array.isArray(list) && list.includes(operation)) {
        next = {
          ...next,
          config: { ...next.config, [key]: list.filter((id) => id !== operation) },
        } as ArchNode;
      }
    }
    if (isFlowNode(next) && next.flows) {
      const flows = Object.fromEntries(
        Object.entries(flowsOf(next))
          .filter(([op]) => op !== operation)
          .map(([op, steps]) => [op, strip(steps)]),
      );
      next = { ...next, flows } as ArchNode;
    }
    return next;
  });

  let traffic = doc.traffic;
  if (traffic?.mix && Object.hasOwn(traffic.mix, operation)) {
    const { [operation]: _removed, ...mix } = traffic.mix;
    traffic = { ...traffic, mix };
  }
  return {
    ...doc,
    operations: doc.operations.filter((o) => o.id !== operation),
    nodes,
    ...(traffic ? { traffic } : {}),
  };
}

/**
 * Copies nodes with new ids and labels, plus the connections between them. Flow steps that use a connection
 * outside the copied set are dropped, since the copy isn't connected there.
 */
export function duplicateNodes(
  doc: ArchitectureDocument,
  nodeIds: Iterable<NodeId>,
  offset: Position = { x: 40, y: 40 },
): { doc: ArchitectureDocument; nodeIds: NodeId[] } {
  const ids = new Set(nodeIds);
  const originals = doc.nodes.filter((n) => ids.has(n.id));
  const nodeMap = new Map(originals.map((n) => [n.id, createId("n")]));
  const innerEdges = doc.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const edgeMap = new Map(innerEdges.map((e) => [e.id, createId("e")]));

  const remap = (steps: FlowStep[]): FlowStep[] =>
    steps.flatMap((step): FlowStep[] => {
      const edge = edgeMap.get(step.edge);
      if (step.type === "cache-lookup") {
        const onMiss = remap(step.onMiss);
        return edge ? [{ ...step, edge, onMiss }] : onMiss;
      }
      return edge ? [{ ...step, edge }] : [];
    });

  let next = doc;
  const created: NodeId[] = [];
  for (const original of originals) {
    const id = nodeMap.get(original.id)!;
    const copy = {
      ...structuredClone(original),
      id,
      label: uniqueLabel(next, original.label),
    } as ArchNode;
    if (isFlowNode(copy) && copy.flows) {
      (copy as { flows: Flows }).flows = Object.fromEntries(
        Object.entries(flowsOf(copy)).map(([op, steps]) => [op, remap(steps)]),
      );
    }
    const at = doc.layout[original.id] ?? { x: 0, y: 0 };
    next = addNode(next, copy, { x: at.x + offset.x, y: at.y + offset.y });
    created.push(id);
  }
  const edges = innerEdges.map((e) => ({
    ...e,
    id: edgeMap.get(e.id)!,
    source: nodeMap.get(e.source)!,
    target: nodeMap.get(e.target)!,
  }));
  return { doc: { ...next, edges: [...next.edges, ...edges] }, nodeIds: created };
}

export interface StepSuggestion {
  operation: OperationId;
  /** Short description, e.g. `Look up "Cache" first; on a miss, run the existing steps`. */
  description: string;
  /** The complete new flow for `operation` if the suggestion is applied. */
  steps: FlowStep[];
}

/**
 * Suggested steps for a connection out of a service or worker (PG-3). Suggestions are offered, never applied
 * automatically, and the simulator never infers steps.
 */
export function suggestSteps(doc: ArchitectureDocument, edgeId: EdgeId): StepSuggestion[] {
  const edge = doc.edges.find((e) => e.id === edgeId);
  const source = edge && doc.nodes.find((n) => n.id === edge.source);
  const target = edge && doc.nodes.find((n) => n.id === edge.target);
  if (!edge || !source || !target || !isFlowNode(source)) return [];

  const flows = flowsOf(source);
  const role = roleOf(target.type);
  // A worker only handles the messages it consumes. A service may handle any operation clients send, so it's
  // offered those too: adding a step for one operation must not hide the suggestion for the next.
  const handled = Object.keys(flows);
  const operations = doc.operations.filter(
    (o) => handled.includes(o.id) || (roleOf(source.type) === "service" && o.share > 0),
  );

  const suggestions: StepSuggestion[] = [];
  for (const op of operations) {
    const current = flows[op.id] ?? [];
    let uses = false;
    walkSteps(current, (s) => {
      if (s.edge === edgeId) uses = true;
    });
    if (uses) continue;

    let step: FlowStep;
    let description: string;
    let steps: FlowStep[];
    if (role === "cache" && op.kind === "read") {
      steps = [{ type: "cache-lookup", edge: edgeId, populate: true, onMiss: current }];
      description =
        current.length > 0
          ? `Look up "${target.label}" first; on a miss, run the existing steps and populate the cache`
          : `Look up "${target.label}" first`;
      if (nestingDepth(steps) > LIMITS.flowNesting) continue;
      suggestions.push({ operation: op.id, description, steps });
      continue;
    } else if (role === "cache") {
      step = { type: "call", edge: edgeId, as: "write", optional: true };
      description = `Update "${target.label}" after the other steps (best effort)`;
    } else if (role === "queue" || role === "stream") {
      step = { type: "publish", edge: edgeId };
      description = `Publish a message to "${target.label}"`;
    } else {
      step = { type: "call", edge: edgeId };
      description = `Call "${target.label}"`;
    }
    steps = [...current, step];
    suggestions.push({ operation: op.id, description, steps });
  }
  return suggestions;
}

export function nestingDepth(steps: readonly FlowStep[]): number {
  let depth = 0;
  walkSteps(steps, (_s, d) => {
    depth = Math.max(depth, d);
  });
  // A lookup's on-miss list counts as a level even when empty.
  walkSteps(steps, (s, d) => {
    if (s.type === "cache-lookup") depth = Math.max(depth, d + 1);
  });
  return depth;
}

function uniqueLabel(doc: ArchitectureDocument, base: string): string {
  const taken = new Set(doc.nodes.map((n) => n.label));
  if (!taken.has(base)) return base;
  const stem = base.replace(/ \d+$/, "");
  for (let i = 2; ; i++) {
    const candidate = `${stem} ${i}`.slice(0, LIMITS.labelLength);
    if (!taken.has(candidate)) return candidate;
  }
}
