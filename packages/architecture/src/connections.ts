import { CATALOG, type ComponentRole, type ComponentType, roleOf } from "./catalog";
import type { ArchitectureDocument, EdgeSide, NodeId } from "./schema";

/** Which target roles each source role may connect to (ARCHITECTURE §6.4, PG-2). */
export const ALLOWED_TARGET_ROLES: Record<ComponentRole, readonly ComponentRole[]> = {
  source: ["edge-cache", "distributor", "service"],
  "edge-cache": ["distributor", "service"],
  distributor: ["distributor", "service"],
  service: ["service", "distributor", "cache", "store", "queue", "stream"],
  consumer: ["service", "distributor", "cache", "store", "queue", "stream"],
  cache: [],
  store: [],
  queue: ["consumer"],
  stream: ["consumer"],
};

export type ConnectionCheck = { ok: true } | { ok: false; reason: string };

/** Whether a component of type `source` may connect to one of type `target`, with a teaching explanation if not. */
export function checkConnectionTypes(source: ComponentType, target: ComponentType): ConnectionCheck {
  const s = roleOf(source);
  const t = roleOf(target);
  if (ALLOWED_TARGET_ROLES[s].includes(t)) return { ok: true };
  return { ok: false, reason: refusalReason(source, target) };
}

/** Checks the sides a connection is drawn between: any side except leaving from the left, where lines come in. */
export function checkEdgeSides(sides: {
  source?: EdgeSide | undefined;
  target?: EdgeSide | undefined;
}): ConnectionCheck {
  if (sides.source === "left") {
    return {
      ok: false,
      reason:
        "A connection can't leave from the left side of a box: that's where connections come in. Start it from the top, right or bottom.",
    };
  }
  return { ok: true };
}

/** Full check for drawing a connection in a document: types, self-loops and duplicates. */
export function checkConnection(
  doc: ArchitectureDocument,
  sourceId: NodeId,
  targetId: NodeId,
): ConnectionCheck {
  if (sourceId === targetId) return { ok: false, reason: "A component can't connect to itself." };
  const source = doc.nodes.find((n) => n.id === sourceId);
  const target = doc.nodes.find((n) => n.id === targetId);
  if (!source || !target) return { ok: false, reason: "Both ends of a connection must be components." };
  if (doc.edges.some((e) => e.source === sourceId && e.target === targetId)) {
    return { ok: false, reason: `"${source.label}" is already connected to "${target.label}".` };
  }
  return checkConnectionTypes(source.type, target.type);
}

const article = (name: string) => (/^[aeiou]/i.test(name) ? `An ${name}` : `A ${name}`);

function refusalReason(source: ComponentType, target: ComponentType): string {
  const s = CATALOG[source];
  const t = CATALOG[target];
  const from = article(s.name.toLowerCase());
  const to = t.name.toLowerCase();

  switch (t.role) {
    case "source":
      return `${article(t.name.toLowerCase())} only starts requests. Nothing connects into a client.`;
    case "consumer":
      return `Background workers receive work through a message queue or event stream. Publish to a queue and connect the queue to the worker.`;
  }
  switch (s.role) {
    case "store":
      return `${from} answers requests but doesn't start them, so it can't connect to a ${to}. Connect services to the ${s.name.toLowerCase()} instead.`;
    case "cache":
      return `A cache answers lookups but doesn't start requests. Connect services to the cache instead.`;
    case "queue":
    case "stream":
      return `${from} delivers messages to background workers, not to a ${to}.`;
    case "source":
    case "edge-cache":
      return `${from} sends requests to load balancers, gateways or servers, not directly to a ${to}. Route through an API server.`;
    case "distributor":
      return `${from} forwards requests to servers or other balancers. Let an API server talk to the ${to}.`;
  }
  return `${from} can't connect to a ${to}.`;
}
