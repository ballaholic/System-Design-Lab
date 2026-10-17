import {
  type ArchitectureDocument,
  type ArchNode,
  CATALOG,
  type ComponentType,
  type FlowStep,
  type Flows,
  type Operation,
} from "@sdl/architecture";

/** Terse document builder: `doc().node("lb", "load-balancer").edge("c", "lb").build()`. Edge ids are `a->b`. */
export function doc(operations: Operation[] = urlShortenerOperations()) {
  const d: ArchitectureDocument = { schemaVersion: 1, operations, nodes: [], edges: [], layout: {} };
  const api = {
    node(
      id: string,
      type: ComponentType,
      options: { config?: Record<string, unknown>; flows?: Flows; label?: string } = {},
    ) {
      d.nodes.push({
        id,
        type,
        label: options.label ?? id,
        config: { ...CATALOG[type].defaults, ...options.config },
        ...(options.flows ? { flows: options.flows } : {}),
      } as ArchNode);
      d.layout[id] = { x: d.nodes.length * 100, y: 0 };
      return api;
    },
    edge(source: string, target: string) {
      d.edges.push({ id: `${source}->${target}`, source, target });
      return api;
    },
    build: () => d,
  };
  return api;
}

export function urlShortenerOperations(): Operation[] {
  return [
    { id: "redirect", name: "Follow short link", kind: "read", share: 10 },
    { id: "create", name: "Create short link", kind: "write", share: 1 },
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
): FlowStep => ({ type: "publish", edge, ...extra });
export const lookup = (edge: string, onMiss: FlowStep[] = [], populate?: boolean): FlowStep => ({
  type: "cache-lookup",
  edge,
  onMiss,
  ...(populate === undefined ? {} : { populate }),
});

/** Sets config values on a node in place (tests tweak fixtures). */
export function configure(d: ArchitectureDocument, id: string, config: Record<string, unknown>) {
  const node = d.nodes.find((n) => n.id === id)!;
  node.config = { ...node.config, ...config } as never;
  return d;
}

export function flowsOfNode(d: ArchitectureDocument, id: string): Flows {
  const node = d.nodes.find((n) => n.id === id) as { flows?: Flows };
  return (node.flows ??= {});
}
