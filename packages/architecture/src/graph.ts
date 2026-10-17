import { roleOf } from "./catalog";
import {
  type ArchEdge,
  type ArchitectureDocument,
  type ArchNode,
  type EdgeId,
  type FlowStep,
  flowsOf,
  type NodeId,
  type OperationId,
} from "./schema";

export interface Graph {
  nodes: Map<NodeId, ArchNode>;
  edges: Map<EdgeId, ArchEdge>;
  outgoing: Map<NodeId, ArchEdge[]>;
  incoming: Map<NodeId, ArchEdge[]>;
}

export function buildGraph(doc: ArchitectureDocument): Graph {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const edges = new Map(doc.edges.map((e) => [e.id, e]));
  const outgoing = new Map<NodeId, ArchEdge[]>(doc.nodes.map((n) => [n.id, []]));
  const incoming = new Map<NodeId, ArchEdge[]>(doc.nodes.map((n) => [n.id, []]));
  for (const e of doc.edges) {
    outgoing.get(e.source)?.push(e);
    incoming.get(e.target)?.push(e);
  }
  return { nodes, edges, outgoing, incoming };
}

/** Visits every step depth-first, including nested on-miss steps. */
export function walkSteps(
  steps: readonly FlowStep[],
  visit: (step: FlowStep, depth: number) => void,
  depth = 1,
): void {
  for (const step of steps) {
    visit(step, depth);
    if (step.type === "cache-lookup") walkSteps(step.onMiss, visit, depth + 1);
  }
}

export function countSteps(steps: readonly FlowStep[]): number {
  let count = 0;
  walkSteps(steps, () => count++);
  return count;
}

/** Edge ids referenced by any step of any flow in the document. */
export function edgesUsedByFlows(doc: ArchitectureDocument): Set<EdgeId> {
  const used = new Set<EdgeId>();
  for (const node of doc.nodes) {
    for (const steps of Object.values(flowsOf(node))) walkSteps(steps, (s) => used.add(s.edge));
  }
  return used;
}

/** Operations a client sends: its configured list, or every operation when unset. */
export function operationsSentBy(node: ArchNode, doc: ArchitectureDocument): OperationId[] {
  if (roleOf(node.type) !== "source") return [];
  const configured = (node.config as { operations?: OperationId[] }).operations;
  return configured ?? doc.operations.map((o) => o.id);
}

/**
 * Whether `nodeId` can handle `operation` when a client or distributor routes it there (ARCHITECTURE §6.4):
 * a service with a flow for it, or a distributor or CDN with at least one capable target.
 */
export function createCapability(doc: ArchitectureDocument, graph: Graph = buildGraph(doc)) {
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();

  function canHandle(nodeId: NodeId, operation: OperationId): boolean {
    const key = `${nodeId}\u0000${operation}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) return false; // cycle guard; cycles are reported separately
    const node = graph.nodes.get(nodeId);
    if (!node) return false;
    visiting.add(key);
    let result: boolean;
    switch (roleOf(node.type)) {
      case "service":
        result = Object.hasOwn(flowsOf(node), operation);
        break;
      case "distributor":
      case "edge-cache":
        result = (graph.outgoing.get(nodeId) ?? []).some((e) => canHandle(e.target, operation));
        break;
      default:
        result = false;
    }
    visiting.delete(key);
    memo.set(key, result);
    return result;
  }

  return canHandle;
}
