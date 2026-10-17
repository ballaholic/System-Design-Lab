// Forward pass (offered load, admission, propagation) and success model (ARCHITECTURE §6.5 steps 4–5).

import type { EdgeId, FlowStep, NodeId, OperationId, TrafficProfile } from "@sdl/architecture";
import { flowsOf } from "@sdl/architecture";
import type { Capacity, Model } from "./model";
import type { Resource } from "./types";

/**
 * "capped" is the real run. "uncapped" admits everything a healthy component receives (down components still
 * admit nothing), which gives the demand used by capacity analysis.
 */
export type Mode = "capped" | "uncapped";

export interface Inflow {
  op: OperationId;
  res: Resource;
  rate: number;
  kind: "request" | "lookup" | "message";
}

export interface CacheStats {
  lookups: number;
  hitRate: number;
  effectiveHitRate: number;
  otherOps: number;
  populateOffered: number;
  populateAdmitted: number;
}

export interface PublicationRecord {
  nodeId: NodeId;
  operation: OperationId;
  stepPath: number[];
  brokerId: NodeId;
  message: OperationId;
  attempted: number;
}

export interface DeliveryRecord {
  brokerId: NodeId;
  consumerId: NodeId;
  message: OperationId;
  inflow: number;
}

export interface BrokerStats {
  kind: "queue" | "stream";
  inflow: number;
  accepted: number;
  /** Accepted messages that no consumer has a flow for. */
  unassigned: number;
  consumerGroups: number;
}

export interface Pass {
  admission: Map<NodeId, Capacity>;
  offered: Map<NodeId, Capacity>;
  inflow: Map<NodeId, Inflow[]>;
  edgeFlow: Map<EdgeId, number>;
  cache: Map<NodeId, CacheStats>;
  unroutable: Array<{ nodeId: NodeId; op: OperationId; rate: number }>;
  publications: PublicationRecord[];
  deliveries: DeliveryRecord[];
  brokers: Map<NodeId, BrokerStats>;
}

interface PendingMiss {
  nodeId: NodeId;
  op: OperationId;
  rate: number;
  onMiss: FlowStep[];
  populate: boolean;
  path: number[];
}

/** Requests per second of each operation, from total RPS and the mix (normalised shares). */
export function operationRates(model: Model, traffic: TrafficProfile): Map<OperationId, number> {
  const shares = model.doc.operations.map((o) => [o.id, traffic.mix?.[o.id] ?? o.share] as const);
  const total = sum(shares.map(([, s]) => s));
  return new Map(shares.map(([id, s]) => [id, total > 0 ? (traffic.totalRps * s) / total : 0]));
}

export function forwardPass(model: Model, traffic: TrafficProfile, mode: Mode): Pass {
  const { g } = model;
  const pass: Pass = {
    admission: new Map(),
    offered: new Map(),
    inflow: new Map(),
    edgeFlow: new Map(),
    cache: new Map(),
    unroutable: [],
    publications: [],
    deliveries: [],
    brokers: new Map(),
  };
  const pending = new Map<NodeId, PendingMiss[]>();

  const addInflow = (to: NodeId, rec: Inflow) => {
    const list = pass.inflow.get(to);
    if (list) list.push(rec);
    else pass.inflow.set(to, [rec]);
  };
  const addEdge = (id: EdgeId, rate: number) => pass.edgeFlow.set(id, (pass.edgeFlow.get(id) ?? 0) + rate);

  const admit = (id: NodeId, res: Resource, offered: number): number => {
    const cap = model.capacity.get(id)?.[res] ?? 0;
    const a = cap === 0 ? 0 : mode === "uncapped" || offered === 0 ? 1 : Math.min(1, cap / offered);
    setRes(pass.offered, id, res, offered);
    setRes(pass.admission, id, res, a);
    return a;
  };

  const route = (fromId: NodeId, op: OperationId, rate: number) => {
    if (rate === 0) return;
    const targets = model.routableTargets(fromId, op);
    if (targets.length === 0) {
      pass.unroutable.push({ nodeId: fromId, op, rate });
      return;
    }
    const share = rate / targets.length;
    for (const e of targets) {
      addInflow(e.target, { op, res: "total", rate: share, kind: "request" });
      addEdge(e.id, share);
    }
  };

  const executeSteps = (nodeId: NodeId, steps: FlowStep[], op: OperationId, rate: number, path: number[]) => {
    steps.forEach((step, i) => {
      const edge = g.edges.get(step.edge)!;
      const stepPath = [...path, i];
      addEdge(edge.id, rate);
      if (step.type === "call") {
        const targetOp = step.operation ?? op;
        addInflow(edge.target, {
          op: targetOp,
          res: resourceFor(model, edge.target, step, targetOp),
          rate,
          kind: "request",
        });
      } else if (step.type === "cache-lookup") {
        addInflow(edge.target, { op, res: "total", rate, kind: "lookup" });
        const list = pending.get(edge.target) ?? [];
        list.push({
          nodeId,
          op,
          rate,
          onMiss: step.onMiss,
          populate: step.populate ?? false,
          path: stepPath,
        });
        pending.set(edge.target, list);
      } else {
        const message = step.message ?? op;
        addInflow(edge.target, { op: message, res: "total", rate, kind: "message" });
        pass.publications.push({
          nodeId,
          operation: op,
          stepPath,
          brokerId: edge.target,
          message,
          attempted: rate,
        });
      }
    });
  };

  // Clients emit their share of each operation they send.
  const clients = model.doc.nodes.filter((n) => model.role.get(n.id) === "source");
  for (const [op, opRate] of operationRates(model, traffic)) {
    const sending = clients.filter((c) => sends(model, c.id, op));
    const shareTotal = sum(sending.map((c) => model.config.get(c.id)!.share as number));
    for (const c of sending) {
      const share = model.config.get(c.id)!.share as number;
      const rate = shareTotal > 0 ? (opRate * share) / shareTotal : 0;
      addInflow(c.id, { op, res: "total", rate, kind: "request" });
    }
  }

  for (const id of model.order) {
    const recs = pass.inflow.get(id) ?? [];
    const node = g.nodes.get(id)!;
    switch (model.role.get(id)!) {
      case "source": {
        admit(id, "total", sumRate(recs));
        for (const [op, rate] of byOp(recs)) route(id, op, rate);
        break;
      }
      case "distributor": {
        const a = admit(id, "total", sumRate(recs));
        for (const [op, rate] of byOp(recs)) route(id, op, rate * a);
        break;
      }
      case "edge-cache": {
        const a = admit(id, "total", sumRate(recs));
        const hitRate = model.config.get(id)!.hitRate as number;
        const stats: CacheStats = {
          lookups: 0,
          hitRate,
          effectiveHitRate: hitRate,
          otherOps: 0,
          populateOffered: 0,
          populateAdmitted: 0,
        };
        for (const [op, rate] of byOp(recs)) {
          const admitted = rate * a;
          if (model.cacheable(id, op)) {
            stats.lookups += admitted;
            route(id, op, admitted * (1 - hitRate));
          } else {
            stats.otherOps += admitted;
            route(id, op, admitted);
          }
        }
        pass.cache.set(id, stats);
        break;
      }
      case "service":
      case "consumer": {
        // Consumers never reject: what they can't consume stays in the source backlog.
        const a = admit(id, "total", sumRate(recs));
        const flows = flowsOf(node);
        for (const [op, rate] of byOp(recs)) executeSteps(id, flows[op] ?? [], op, rate * a, []);
        break;
      }
      case "cache": {
        const offered = sumRate(recs);
        const a = admit(id, "total", offered);
        const hitRate = model.config.get(id)!.hitRate as number;
        const effectiveHitRate = hitRate * a; // A-CACHE-ERROR-AS-MISS
        let populateOffered = 0;
        for (const p of pending.get(id) ?? []) {
          const misses = p.rate * (1 - effectiveHitRate);
          executeSteps(p.nodeId, p.onMiss, p.op, misses, p.path);
          if (p.populate) populateOffered += misses;
        }
        // A-POPULATE-BEST-EFFORT: fills only use capacity left over by lookups and calls.
        const cap = model.capacity.get(id)?.total ?? 0;
        const leftover = mode === "uncapped" ? (cap > 0 ? Infinity : 0) : Math.max(0, cap - offered * a);
        pass.cache.set(id, {
          lookups: sumRate(recs.filter((r) => r.kind === "lookup")),
          hitRate,
          effectiveHitRate,
          otherOps: sumRate(recs.filter((r) => r.kind !== "lookup")),
          populateOffered,
          populateAdmitted: Math.min(populateOffered, leftover),
        });
        break;
      }
      case "store": {
        admit(id, "read", sumRate(recs.filter((r) => r.res === "read")));
        admit(id, "write", sumRate(recs.filter((r) => r.res === "write")));
        break;
      }
      case "queue":
      case "stream": {
        const kind = model.role.get(id) as "queue" | "stream";
        const inflow = sumRate(recs);
        const a = admit(id, "total", inflow);
        let unassigned = 0;
        const groups = new Set<NodeId>();
        for (const [message, rate] of byOp(recs)) {
          const accepted = rate * a;
          const consumers = model.consumersFor(id, message);
          if (consumers.length === 0) {
            unassigned += accepted;
            continue;
          }
          const caps = consumers.map((e) => model.capacity.get(e.target)?.total ?? 0);
          const totalCap = sum(caps);
          consumers.forEach((e, i) => {
            groups.add(e.target);
            // Streams: every consumer group receives every message. Queues: consumers compete, in proportion
            // to capacity (A-EVEN-SPLIT); an even split when all are down keeps the backlog attributed.
            const share =
              kind === "stream"
                ? accepted
                : totalCap > 0
                  ? (accepted * caps[i]!) / totalCap
                  : accepted / consumers.length;
            addInflow(e.target, { op: message, res: "total", rate: share, kind: "message" });
            addEdge(e.id, share);
            pass.deliveries.push({ brokerId: id, consumerId: e.target, message, inflow: share });
          });
        }
        pass.brokers.set(id, { kind, inflow, accepted: inflow * a, unassigned, consumerGroups: groups.size });
        break;
      }
    }
  }
  return pass;
}

export interface SuccessModel {
  /** Probability that a request of `op` arriving at `id` (using `res`) completes. */
  node(id: NodeId, op: OperationId, res: Resource): number;
  steps(steps: FlowStep[], op: OperationId): number;
}

export function successModel(model: Model, pass: Pass): SuccessModel {
  const memo = new Map<string, number>();
  const a = (id: NodeId, res: Resource) => pass.admission.get(id)?.[res] ?? (model.isDown(id) ? 0 : 1);
  const avgTargets = (id: NodeId, op: OperationId) => {
    const targets = model.routableTargets(id, op);
    return targets.length === 0 ? 0 : sum(targets.map((e) => node(e.target, op, "total"))) / targets.length;
  };

  const node = (id: NodeId, op: OperationId, res: Resource): number => {
    const key = `${id}\u0000${op}\u0000${res}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const n = model.g.nodes.get(id)!;
    const flows = flowsOf(n);
    let p: number;
    switch (model.role.get(id)!) {
      case "source":
        p = avgTargets(id, op);
        break;
      case "distributor":
        p = a(id, "total") * avgTargets(id, op);
        break;
      case "edge-cache": {
        const h = model.config.get(id)!.hitRate as number;
        p =
          a(id, "total") * (model.cacheable(id, op) ? h + (1 - h) * avgTargets(id, op) : avgTargets(id, op));
        break;
      }
      case "service":
        p = Object.hasOwn(flows, op) ? a(id, "total") * steps(flows[op]!, op) : 0;
        break;
      case "consumer":
        // Success of consumed messages; unconsumed ones wait in the backlog rather than fail.
        p = Object.hasOwn(flows, op) ? steps(flows[op]!, op) : 0;
        break;
      case "store":
        p = a(id, res);
        break;
      default: // cache, queue, stream
        p = a(id, "total");
    }
    memo.set(key, p);
    return p;
  };

  const steps = (list: FlowStep[], op: OperationId): number => {
    let p = 1;
    for (const step of list) {
      const target = model.g.edges.get(step.edge)!.target;
      if (step.type === "cache-lookup") {
        const h = pass.cache.get(target)?.effectiveHitRate ?? 0;
        p *= h + (1 - h) * steps(step.onMiss, op);
      } else if (step.optional) {
        continue;
      } else if (step.type === "call") {
        const targetOp = step.operation ?? op;
        p *= node(target, targetOp, resourceFor(model, target, step, targetOp));
      } else {
        p *= a(target, "total");
      }
    }
    return p;
  };

  return { node, steps };
}

function resourceFor(
  model: Model,
  target: NodeId,
  step: { as?: "read" | "write" },
  op: OperationId,
): Resource {
  return model.role.get(target) === "store" ? (step.as ?? model.opKind.get(op) ?? "read") : "total";
}

function sends(model: Model, clientId: NodeId, op: OperationId): boolean {
  const ops = model.config.get(clientId)!.operations as string[] | undefined;
  return ops ? ops.includes(op) : true;
}

function setRes(map: Map<NodeId, Capacity>, id: NodeId, res: Resource, value: number) {
  const entry = map.get(id);
  if (entry) entry[res] = value;
  else map.set(id, { [res]: value });
}

export function byOp(recs: readonly Inflow[]): Map<OperationId, number> {
  const m = new Map<OperationId, number>();
  for (const r of recs) m.set(r.op, (m.get(r.op) ?? 0) + r.rate);
  return m;
}

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
export const sumRate = (recs: readonly Inflow[]) => recs.reduce((a, r) => a + r.rate, 0);
