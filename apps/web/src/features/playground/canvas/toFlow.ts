import {
  type ArchitectureDocument,
  type ArchNode,
  buildGraph,
  createCapability,
  type EdgeId,
  flowsOf,
  type NodeId,
  type OperationId,
  operationsSentBy,
  roleOf,
  type ValidationIssue,
  walkSteps,
} from "@sdl/architecture";
import type { Edge, Node } from "@xyflow/react";
import type { Selection } from "../store/editorStore";

export type IssueLevel = "error" | "warning" | null;

export type ComponentNodeData = {
  node: ArchNode;
  issueLevel: IssueLevel;
  issueCount: number;
};
export type ComponentFlowNode = Node<ComponentNodeData, "component">;

export type ConnectionEdgeData = {
  /** Into a queue or stream: rendered dashed. */
  async: boolean;
  /** Names of the operations this connection carries; empty means it carries no traffic. */
  carries: string[];
  label?: string;
  issueLevel: IssueLevel;
};
export type ConnectionFlowEdge = Edge<ConnectionEdgeData, "connection">;

export type Measured = Map<NodeId, { width?: number; height?: number }>;

export function toFlowNodes(
  doc: ArchitectureDocument,
  selection: Selection,
  issues: readonly ValidationIssue[],
  measured: Measured = new Map(),
): ComponentFlowNode[] {
  const levels = issueLevels(issues, "nodeIds");
  const selected = new Set(selection.nodeIds);
  return doc.nodes.map((node, index) => {
    const level = levels.get(node.id);
    const size = measured.get(node.id);
    return {
      id: node.id,
      type: "component",
      position: doc.layout[node.id] ?? { x: (index % 6) * 220, y: Math.floor(index / 6) * 140 },
      selected: selected.has(node.id),
      data: { node, issueLevel: level?.level ?? null, issueCount: level?.count ?? 0 },
      ...(size ? { measured: size } : {}),
    };
  });
}

export function toFlowEdges(
  doc: ArchitectureDocument,
  selection: Selection,
  issues: readonly ValidationIssue[],
): ConnectionFlowEdge[] {
  const levels = issueLevels(issues, "edgeIds");
  const selected = new Set(selection.edgeIds);
  const carries = edgeCarries(doc);
  const names = new Map(doc.operations.map((o) => [o.id, o.name]));
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  return doc.edges.map((edge) => {
    const target = nodes.get(edge.target);
    const role = target ? roleOf(target.type) : null;
    return {
      id: edge.id,
      type: "connection",
      source: edge.source,
      target: edge.target,
      selected: selected.has(edge.id),
      data: {
        async: role === "queue" || role === "stream",
        carries: [...(carries.get(edge.id) ?? [])].map((id) => names.get(id) ?? id),
        ...(edge.label ? { label: edge.label } : {}),
        issueLevel: levels.get(edge.id)?.level ?? null,
      },
    };
  });
}

/**
 * Operations each connection carries: flow steps for connections out of services and workers, routable
 * operations for connections out of clients, distributors and CDNs, and published messages a worker
 * handles for connections out of queues and streams.
 */
export function edgeCarries(doc: ArchitectureDocument): Map<EdgeId, Set<OperationId>> {
  const g = buildGraph(doc);
  const canHandle = createCapability(doc, g);
  const carries = new Map<EdgeId, Set<OperationId>>();
  const add = (edge: EdgeId, op: OperationId) => {
    let set = carries.get(edge);
    if (!set) carries.set(edge, (set = new Set()));
    set.add(op);
  };
  const published = new Map<NodeId, Set<OperationId>>();

  for (const node of doc.nodes) {
    for (const [op, steps] of Object.entries(flowsOf(node))) {
      walkSteps(steps, (step) => {
        const message =
          step.type === "call" ? (step.operation ?? op) : step.type === "publish" ? (step.message ?? op) : op;
        add(step.edge, message);
        if (step.type === "publish") {
          const broker = g.edges.get(step.edge)?.target;
          if (broker) {
            let set = published.get(broker);
            if (!set) published.set(broker, (set = new Set()));
            set.add(message);
          }
        }
      });
    }
  }

  for (const edge of doc.edges) {
    const source = g.nodes.get(edge.source);
    const target = g.nodes.get(edge.target);
    if (!source || !target) continue;
    const role = roleOf(source.type);
    if (role === "source" || role === "distributor" || role === "edge-cache") {
      const ops = role === "source" ? operationsSentBy(source, doc) : doc.operations.map((o) => o.id);
      for (const op of ops) if (canHandle(target.id, op)) add(edge.id, op);
    } else if (role === "queue" || role === "stream") {
      const handled = flowsOf(target);
      for (const message of published.get(source.id) ?? [])
        if (Object.hasOwn(handled, message)) add(edge.id, message);
    }
  }
  return carries;
}

function issueLevels(
  issues: readonly ValidationIssue[],
  key: "nodeIds" | "edgeIds",
): Map<string, { level: Exclude<IssueLevel, null>; count: number }> {
  const result = new Map<string, { level: Exclude<IssueLevel, null>; count: number }>();
  for (const issue of issues) {
    if (issue.severity === "info") continue;
    for (const id of issue[key] ?? []) {
      const current = result.get(id);
      const level = current?.level === "error" || issue.severity === "error" ? "error" : "warning";
      result.set(id, { level, count: (current?.count ?? 0) + 1 });
    }
  }
  return result;
}
