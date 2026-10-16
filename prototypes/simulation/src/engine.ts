// Deterministic steady-state request-flow engine (ARCHITECTURE §6).
// Pure: no I/O, no randomness, no clock. Same input ⇒ deep-equal output.

import { ASSUMPTIONS } from "./assumptions.js";
import { DEFAULTS, ROLE, TARGET_UTILIZATION, WARM_UTILIZATION, type Role } from "./catalog.js";
import type {
  ArchitectureDocument,
  ArchNode,
  CapacityAnalysis,
  DeliveryOutcome,
  EdgeId,
  FailureScenario,
  FlowStep,
  NodeId,
  NodeResult,
  OperationId,
  OperationKind,
  OperationOutcome,
  Resource,
  SimEvent,
  SimulationResult,
  TrafficProfile,
  ValidationIssue,
} from "./model.js";
import { buildGraph, flowsOf, validate, type Graph } from "./validate.js";

export const ENGINE_VERSION = "0.1.0-prototype";

type Capacity = Partial<Record<Resource, number>>;
type Mode = "capped" | "uncapped";

interface Inflow {
  op: OperationId;
  res: Resource;
  rate: number;
  kind: "request" | "lookup" | "populate" | "message";
  from: NodeId;
}

interface PendingMiss {
  fromNode: ArchNode;
  op: OperationId;
  rate: number;
  onMiss: FlowStep[];
  populate: boolean;
}

interface CacheStats {
  lookups: number;
  hitRate: number;
  effectiveHitRate: number;
  otherOps: number;
  populateOffered: number;
  populateAdmitted: number;
}

interface Publication {
  nodeId: NodeId;
  op: OperationId;
  stepPath: string;
  queueId: NodeId;
  message: OperationId;
  attempted: number;
}

interface Pass {
  admission: Map<NodeId, Capacity>;
  offered: Map<NodeId, Capacity>;
  inflow: Map<NodeId, Inflow[]>;
  edgeFlow: Map<EdgeId, number>;
  cache: Map<NodeId, CacheStats>;
  unroutable: Array<{ nodeId: NodeId; op: OperationId; rate: number }>;
  publications: Publication[];
  deliveries: Map<string, { brokerId: NodeId; consumerId: NodeId; message: OperationId; inflow: number }>;
  queues: Map<NodeId, { inflow: number; accepted: number; unassigned: number }>;
}

interface Context {
  doc: ArchitectureDocument;
  g: Graph;
  order: NodeId[];
  capacity: Map<NodeId, Capacity>;
  opKind: Map<OperationId, OperationKind>;
  opRates: Map<OperationId, number>;
  serveMemo: Map<string, boolean>;
}

export function simulate(
  doc: ArchitectureDocument,
  traffic: TrafficProfile,
  scenario: FailureScenario = { failures: [] },
): SimulationResult {
  const { issues, order } = validate(doc);
  if (!order) return invalidResult(issues);

  const ctx: Context = {
    doc,
    g: buildGraph(doc),
    order,
    capacity: new Map(doc.nodes.map((n) => [n.id, effectiveCapacity(n, scenario)])),
    opKind: new Map(doc.operations.map((o) => [o.id, o.kind])),
    opRates: operationRates(doc, traffic),
    serveMemo: new Map(),
  };

  const pass = forwardPass(ctx, "capped");
  const success = successModel(ctx, pass);

  const nodes = nodeResults(ctx, pass);
  const operations = operationOutcomes(ctx, pass, success);
  const deliveries = deliveryOutcomes(pass, success);
  const capacity = capacityAnalysis(ctx, traffic);
  const events = detectEvents(ctx, scenario, pass, nodes, success);

  const offered = sum(Object.values(operations).map((o) => o.offered));
  const succeeded = sum(Object.values(operations).map((o) => o.processingSucceeded));

  return {
    engineVersion: ENGINE_VERSION,
    status: "ok",
    issues,
    nodes,
    edges: Object.fromEntries(doc.edges.map((e) => [e.id, pass.edgeFlow.get(e.id) ?? 0])),
    operations,
    deliveries,
    summary: {
      offered,
      processingSucceeded: succeeded,
      processingSuccessRate: offered > 0 ? succeeded / offered : 1,
      bottlenecks: bottlenecks(nodes),
    },
    capacity,
    events,
    assumptions: ASSUMPTIONS.map((a) => a.id),
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function operationRates(doc: ArchitectureDocument, traffic: TrafficProfile): Map<OperationId, number> {
  const shares = doc.operations.map((o) => [o.id, traffic.mix?.[o.id] ?? o.share] as const);
  const total = sum(shares.map(([, s]) => s));
  return new Map(shares.map(([id, s]) => [id, total > 0 ? (traffic.totalRps * s) / total : 0]));
}

function effectiveCapacity(node: ArchNode, scenario: FailureScenario): Capacity {
  const failures = scenario.failures.filter((f) => f.nodeId === node.id);
  const has = (kind: string) => failures.some((f) => f.kind === kind);
  const failedInstances = sum(failures.map((f) => (f.kind === "app-instance-failure" ? f.count : 0)));

  switch (node.type) {
    case "web-client":
    case "mobile-client":
      return { total: Infinity };
    case "load-balancer":
      return { total: node.config.capacityRps ?? DEFAULTS.loadBalancerCapacityRps };
    case "api-server": {
      const healthy = Math.max(0, (node.config.instances ?? DEFAULTS.apiServerInstances) - failedInstances);
      return { total: healthy * (node.config.capacityPerInstance ?? DEFAULTS.apiServerCapacityPerInstance) };
    }
    case "background-worker": {
      if (has("worker-down")) return { total: 0 };
      const healthy = Math.max(0, (node.config.instances ?? DEFAULTS.workerInstances) - failedInstances);
      return { total: healthy * (node.config.throughputPerInstance ?? DEFAULTS.workerThroughputPerInstance) };
    }
    case "redis-cache":
      return { total: has("cache-down") ? 0 : node.config.capacityOps ?? DEFAULTS.cacheCapacityOps };
    case "sql-database":
      return has("database-primary-down")
        ? { read: 0, write: 0 }
        : {
            read: node.config.readCapacity ?? DEFAULTS.sqlReadCapacity,
            write: node.config.writeCapacity ?? DEFAULTS.sqlWriteCapacity,
          };
    case "message-queue":
      return { total: node.config.enqueueCapacity ?? DEFAULTS.queueEnqueueCapacity };
  }
}

function isDown(ctx: Context, id: NodeId): boolean {
  const cap = ctx.capacity.get(id) ?? {};
  return Object.values(cap).every((c) => c === 0);
}

function roleOf(ctx: Context, id: NodeId): Role {
  return ROLE[ctx.g.nodes.get(id)!.type];
}

/** Can this node (directly or via distributors) handle the operation, given current failures? */
function canServe(ctx: Context, id: NodeId, op: OperationId): boolean {
  const key = `${id}|${op}`;
  const cached = ctx.serveMemo.get(key);
  if (cached !== undefined) return cached;
  ctx.serveMemo.set(key, false); // guards against revisiting during recursion
  let result = false;
  if (!isDown(ctx, id)) {
    const node = ctx.g.nodes.get(id)!;
    const role = ROLE[node.type];
    if (role === "service") result = op in flowsOf(node);
    else if (role === "distributor") result = routableTargets(ctx, id, op).length > 0;
  }
  ctx.serveMemo.set(key, result);
  return result;
}

function routableTargets(ctx: Context, id: NodeId, op: OperationId) {
  return (ctx.g.outgoing.get(id) ?? []).filter((e) => canServe(ctx, e.target, op));
}

function consumersFor(ctx: Context, queueId: NodeId, message: OperationId) {
  return (ctx.g.outgoing.get(queueId) ?? []).filter((e) => {
    const n = ctx.g.nodes.get(e.target)!;
    return ROLE[n.type] === "consumer" && message in flowsOf(n);
  });
}

// ---------------------------------------------------------------------------
// Forward pass: offered load, admission, propagation
// ---------------------------------------------------------------------------

function forwardPass(ctx: Context, mode: Mode): Pass {
  const pass: Pass = {
    admission: new Map(),
    offered: new Map(),
    inflow: new Map(),
    edgeFlow: new Map(),
    cache: new Map(),
    unroutable: [],
    publications: [],
    deliveries: new Map(),
    queues: new Map(),
  };
  const pending = new Map<NodeId, PendingMiss[]>();

  const addInflow = (to: NodeId, rec: Inflow) => {
    const list = pass.inflow.get(to) ?? [];
    list.push(rec);
    pass.inflow.set(to, list);
  };
  const addEdge = (id: EdgeId, rate: number) => pass.edgeFlow.set(id, (pass.edgeFlow.get(id) ?? 0) + rate);

  const admit = (id: NodeId, res: Resource, offered: number): number => {
    const cap = ctx.capacity.get(id)?.[res] ?? 0;
    const off = pass.offered.get(id) ?? {};
    off[res] = offered;
    pass.offered.set(id, off);
    const a = cap === 0 ? 0 : mode === "uncapped" || offered === 0 ? 1 : Math.min(1, cap / offered);
    const adm = pass.admission.get(id) ?? {};
    adm[res] = a;
    pass.admission.set(id, adm);
    return a;
  };

  const route = (from: ArchNode, op: OperationId, rate: number) => {
    if (rate === 0) return;
    const targets = routableTargets(ctx, from.id, op);
    if (targets.length === 0) {
      pass.unroutable.push({ nodeId: from.id, op, rate });
      return;
    }
    for (const e of targets) {
      addInflow(e.target, { op, res: "total", rate: rate / targets.length, kind: "request", from: from.id });
      addEdge(e.id, rate / targets.length);
    }
  };

  const executeSteps = (node: ArchNode, steps: FlowStep[], op: OperationId, rate: number, path: string) => {
    steps.forEach((step, i) => {
      const edge = ctx.g.edges.get(step.edge)!;
      const stepPath = `${path}/${i}`;
      addEdge(edge.id, rate);
      if (step.type === "call") {
        const targetOp = step.operation ?? op;
        const res: Resource =
          roleOf(ctx, edge.target) === "store" ? step.as ?? ctx.opKind.get(targetOp) ?? "read" : "total";
        addInflow(edge.target, { op: targetOp, res, rate, kind: "request", from: node.id });
      } else if (step.type === "cache-lookup") {
        addInflow(edge.target, { op, res: "total", rate, kind: "lookup", from: node.id });
        const list = pending.get(edge.target) ?? [];
        list.push({ fromNode: node, op, rate, onMiss: step.onMiss, populate: step.populate ?? false });
        pending.set(edge.target, list);
      } else {
        const message = step.message ?? op;
        addInflow(edge.target, { op: message, res: "total", rate, kind: "message", from: node.id });
        pass.publications.push({ nodeId: node.id, op, stepPath, queueId: edge.target, message, attempted: rate });
      }
    });
  };

  // Clients emit their share of each operation they issue.
  const clients = ctx.doc.nodes.filter((n) => ROLE[n.type] === "source");
  for (const [op, opRate] of ctx.opRates) {
    const issuing = clients.filter((c) => clientIssues(c, op, ctx));
    const shareTotal = sum(issuing.map(clientShare));
    for (const c of issuing) addInflow(c.id, { op, res: "total", rate: (opRate * clientShare(c)) / shareTotal, kind: "request", from: c.id });
  }

  for (const id of ctx.order) {
    const node = ctx.g.nodes.get(id)!;
    const recs = pass.inflow.get(id) ?? [];
    const role = ROLE[node.type];

    switch (role) {
      case "source": {
        admit(id, "total", sumRate(recs));
        for (const [op, rate] of byOp(recs)) route(node, op, rate);
        break;
      }
      case "distributor": {
        const a = admit(id, "total", sumRate(recs));
        for (const [op, rate] of byOp(recs)) route(node, op, rate * a);
        break;
      }
      case "service": {
        const a = admit(id, "total", sumRate(recs));
        const flows = flowsOf(node);
        for (const [op, rate] of byOp(recs)) executeSteps(node, flows[op] ?? [], op, rate * a, op);
        break;
      }
      case "consumer": {
        // Unconsumed messages stay in the source backlog (consumption = inflow × admission).
        const a = admit(id, "total", sumRate(recs));
        const flows = flowsOf(node);
        for (const [op, rate] of byOp(recs)) executeSteps(node, flows[op] ?? [], op, rate * a, op);
        break;
      }
      case "cache": {
        const primary = recs.filter((r) => r.kind !== "populate");
        const primaryOffered = sumRate(primary);
        const a = admit(id, "total", primaryOffered);
        const hitRate = node.type === "redis-cache" ? node.config.hitRate ?? DEFAULTS.cacheHitRate : 0;
        const effectiveHitRate = hitRate * a; // A-CACHE-ERROR-AS-MISS
        let populateOffered = 0;
        for (const p of pending.get(id) ?? []) {
          const misses = p.rate * (1 - effectiveHitRate);
          executeSteps(p.fromNode, p.onMiss, p.op, misses, `${p.op}/miss`);
          if (p.populate) populateOffered += misses;
        }
        // A-POPULATE-BEST-EFFORT: populates only use capacity left over by lookups and calls.
        const cap = ctx.capacity.get(id)?.total ?? 0;
        const leftover = mode === "uncapped" ? (cap > 0 ? Infinity : 0) : Math.max(0, cap - primaryOffered * a);
        pass.cache.set(id, {
          lookups: sumRate(primary.filter((r) => r.kind === "lookup")),
          hitRate,
          effectiveHitRate,
          otherOps: sumRate(primary.filter((r) => r.kind !== "lookup")),
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
      case "queue": {
        const inflow = sumRate(recs);
        const a = admit(id, "total", inflow);
        let unassigned = 0;
        for (const [message, rate] of byOp(recs)) {
          const accepted = rate * a;
          const consumers = consumersFor(ctx, id, message);
          if (consumers.length === 0) {
            unassigned += accepted;
            continue;
          }
          const caps = consumers.map((e) => ctx.capacity.get(e.target)?.total ?? 0);
          const totalCap = sum(caps);
          consumers.forEach((e, i) => {
            // A-EVEN-SPLIT: proportional to consumer capacity; even split when every consumer is down,
            // so the demand (and the unconsumed backlog) stays attributed to them.
            const share = totalCap > 0 ? (accepted * caps[i]!) / totalCap : accepted / consumers.length;
            addInflow(e.target, { op: message, res: "total", rate: share, kind: "message", from: id });
            addEdge(e.id, share);
            pass.deliveries.set(deliveryKey(id, e.target, message), { brokerId: id, consumerId: e.target, message, inflow: share });
          });
        }
        pass.queues.set(id, { inflow, accepted: inflow * a, unassigned });
        break;
      }
    }
  }
  return pass;
}

// ---------------------------------------------------------------------------
// Success model: probability that a request of `op` completes at a node
// ---------------------------------------------------------------------------

interface SuccessModel {
  node(id: NodeId, op: OperationId, res: Resource): number;
  steps(node: ArchNode, steps: FlowStep[], op: OperationId): number;
}

function successModel(ctx: Context, pass: Pass): SuccessModel {
  const memo = new Map<string, number>();
  const a = (id: NodeId, res: Resource) => pass.admission.get(id)?.[res] ?? (isDown(ctx, id) ? 0 : 1);

  const node = (id: NodeId, op: OperationId, res: Resource): number => {
    const key = `${id}|${op}|${res}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const n = ctx.g.nodes.get(id)!;
    let p: number;
    switch (ROLE[n.type]) {
      case "source":
      case "distributor": {
        const targets = routableTargets(ctx, id, op);
        const avg = targets.length === 0 ? 0 : sum(targets.map((e) => node(e.target, op, "total"))) / targets.length;
        p = (ROLE[n.type] === "source" ? 1 : a(id, "total")) * avg;
        break;
      }
      case "service":
        p = op in flowsOf(n) ? a(id, "total") * steps(n, flowsOf(n)[op]!, op) : 0;
        break;
      case "consumer":
        p = op in flowsOf(n) ? steps(n, flowsOf(n)[op]!, op) : 0; // success of consumed messages
        break;
      case "store":
        p = a(id, res);
        break;
      case "cache":
      case "queue":
        p = a(id, "total");
        break;
    }
    memo.set(key, p);
    return p;
  };

  const steps = (n: ArchNode, list: FlowStep[], op: OperationId): number => {
    let p = 1;
    for (const step of list) {
      const target = ctx.g.edges.get(step.edge)!.target;
      if (step.type === "call") {
        if (step.optional) continue;
        const targetOp = step.operation ?? op;
        const res: Resource = roleOf(ctx, target) === "store" ? step.as ?? ctx.opKind.get(targetOp) ?? "read" : "total";
        p *= node(target, targetOp, res);
      } else if (step.type === "cache-lookup") {
        const h = pass.cache.get(target)?.effectiveHitRate ?? 0;
        p *= h + (1 - h) * steps(n, step.onMiss, op);
      } else {
        if (step.optional) continue;
        p *= a(target, "total");
      }
    }
    return p;
  };

  return { node, steps };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function nodeResults(ctx: Context, pass: Pass): Record<NodeId, NodeResult> {
  const out: Record<NodeId, NodeResult> = {};
  for (const n of ctx.doc.nodes) {
    const cap = ctx.capacity.get(n.id) ?? {};
    const offered = pass.offered.get(n.id) ?? {};
    const admission = pass.admission.get(n.id) ?? {};
    const recs = pass.inflow.get(n.id) ?? [];
    const cache = pass.cache.get(n.id);
    const resources: NodeResult["resources"] = {};
    const explanation: string[] = [];

    for (const res of Object.keys(cap) as Resource[]) {
      const capacity = cap[res]!;
      if (!Number.isFinite(capacity)) continue; // clients
      let off = offered[res] ?? 0;
      let admitted = off * (admission[res] ?? 0);
      if (cache) {
        off += cache.populateOffered;
        admitted += cache.populateAdmitted;
      }
      const utilization = capacity > 0 ? off / capacity : off > 0 ? Infinity : 0;
      resources[res] = { capacity, offered: off, admitted, rejected: off - admitted, utilization };
      const label = res === "total" ? "" : ` ${res}s`;
      if (ROLE[n.type] === "consumer") {
        // Consumers never reject: unconsumed messages stay in the source backlog.
        if (capacity === 0) explanation.push(`Down: ${fmt(off)} messages/s are not consumed and stay in the backlog.`);
        else if (off > capacity) explanation.push(`Receives ${fmt(off)} messages/s but consumes ${fmt(capacity)}; the rest stays in the backlog.`);
        else if (off > 0) explanation.push(`Consumes ${fmt(off)} messages/s of ${fmt(capacity)} capacity (${pct(utilization)}).`);
      } else if (capacity === 0) explanation.push(`Down: all ${fmt(off)}${label}/s offered are rejected.`);
      else if (off > capacity) explanation.push(`Offered ${fmt(off)}${label}/s vs capacity ${fmt(capacity)} → ${pct(1 - capacity / off)} rejected.`);
      else if (off > 0) explanation.push(`Offered ${fmt(off)}${label}/s of ${fmt(capacity)} capacity (${pct(utilization)}).`);
    }

    const byOperation: NodeResult["byOperation"] = {};
    for (const [op, rate] of byOp(recs)) {
      const res = recs.find((r) => r.op === op)?.res ?? "total";
      byOperation[op] = { offered: rate, admitted: rate * (admission[res] ?? admission.total ?? 1) };
    }

    const result: NodeResult = { status: statusOf(cap, resources, recs.length > 0), resources, byOperation, explanation };
    if (cache) {
      const hits = cache.lookups * cache.effectiveHitRate;
      result.cache = {
        lookups: cache.lookups,
        hits,
        misses: cache.lookups - hits,
        effectiveHitRate: cache.effectiveHitRate,
        otherOps: cache.otherOps,
        populateOffered: cache.populateOffered,
        populateAdmitted: cache.populateAdmitted,
      };
      if (cache.lookups > 0) {
        explanation.push(
          cache.effectiveHitRate < cache.hitRate
            ? `Effective hit rate ${pct(cache.effectiveHitRate)} (configured ${pct(cache.hitRate)}); rejected lookups count as misses.`
            : `Hit rate ${pct(cache.hitRate)}: ${fmt(hits)} hits/s, ${fmt(cache.lookups - hits)} misses/s.`,
        );
      }
    }
    const q = pass.queues.get(n.id);
    if (q) {
      const consumed = sum(
        [...pass.deliveries.values()].filter((d) => d.brokerId === n.id).map((d) => d.inflow * (pass.admission.get(d.consumerId)?.total ?? 0)),
      );
      const growth = q.accepted - consumed;
      const maxDepth = n.type === "message-queue" ? n.config.maxDepth : undefined;
      result.queue = { inflow: q.inflow, accepted: q.accepted, consumed, backlogGrowthPerSec: growth };
      if (maxDepth !== undefined && growth > 1e-9) result.queue.secondsToFull = maxDepth / growth;
      if (growth > 1e-9) explanation.push(`Backlog grows by ${fmt(growth)} messages/s (consumers take ${fmt(consumed)} of ${fmt(q.accepted)}).`);
    }
    out[n.id] = result;
  }
  return out;
}

function statusOf(cap: Capacity, resources: NodeResult["resources"], hasInflow: boolean): NodeResult["status"] {
  const caps = Object.values(cap);
  if (caps.length > 0 && caps.every((c) => c === 0)) return "down";
  const utils = Object.values(resources).map((r) => r!.utilization);
  const max = utils.length ? Math.max(...utils) : 0;
  if (!hasInflow || max === 0) return "idle";
  if (max >= 1) return "saturated";
  if (max >= WARM_UTILIZATION) return "warm";
  return "ok";
}

function operationOutcomes(ctx: Context, pass: Pass, success: SuccessModel): Record<OperationId, OperationOutcome> {
  const out: Record<OperationId, OperationOutcome> = {};
  const clients = ctx.doc.nodes.filter((n) => ROLE[n.type] === "source");
  for (const op of ctx.doc.operations) {
    let offered = 0;
    let accepted = 0;
    let succeeded = 0;
    for (const c of clients) {
      const rate = sumRate((pass.inflow.get(c.id) ?? []).filter((r) => r.op === op.id));
      if (rate === 0) continue;
      offered += rate;
      const targets = routableTargets(ctx, c.id, op.id);
      for (const e of targets) accepted += (rate / targets.length) * (pass.admission.get(e.target)?.total ?? 0);
      succeeded += rate * success.node(c.id, op.id, "total");
    }
    out[op.id] = {
      offered,
      accepted,
      processingSucceeded: succeeded,
      processingSuccessRate: offered > 0 ? succeeded / offered : 1,
      publications: pass.publications
        .filter((p) => p.op === op.id)
        .map((p) => ({
          nodeId: p.nodeId,
          stepPath: p.stepPath,
          queueId: p.queueId,
          message: p.message,
          attempted: p.attempted,
          published: p.attempted * (pass.admission.get(p.queueId)?.total ?? 0),
        })),
    };
  }
  return out;
}

function deliveryOutcomes(pass: Pass, success: SuccessModel): DeliveryOutcome[] {
  return [...pass.deliveries.values()].map((d) => {
    const consumed = d.inflow * (pass.admission.get(d.consumerId)?.total ?? 0);
    return {
      brokerId: d.brokerId,
      consumerId: d.consumerId,
      message: d.message,
      inflow: d.inflow,
      consumed,
      backlogGrowthPerSec: d.inflow - consumed,
      consumerSuccessRate: consumed > 0 ? success.node(d.consumerId, d.message, "total") : null,
    };
  });
}

function bottlenecks(nodes: Record<NodeId, NodeResult>) {
  const list: Array<{ nodeId: NodeId; resource: Resource; utilization: number }> = [];
  for (const [nodeId, r] of Object.entries(nodes)) {
    for (const [resource, rr] of Object.entries(r.resources) as Array<[Resource, NonNullable<NodeResult["resources"][Resource]>]>) {
      if (rr.capacity > 0 && rr.utilization >= WARM_UTILIZATION) list.push({ nodeId, resource, utilization: rr.utilization });
    }
  }
  return list.sort((x, y) => y.utilization - x.utilization || x.nodeId.localeCompare(y.nodeId));
}

/**
 * Exact below saturation: with every admission = 1 (down components stay at 0), loads scale linearly
 * with totalRps, so the breaking point is totalRps × min(capacity / load). Populates are excluded
 * because they are best-effort.
 */
function capacityAnalysis(ctx: Context, traffic: TrafficProfile): CapacityAnalysis {
  const pass = forwardPass(ctx, "uncapped");
  let best: { ratio: number; nodeId: NodeId; resource: Resource } | null = null;
  const instancesNeeded: Record<NodeId, number> = {};

  for (const id of ctx.order) {
    const cap = ctx.capacity.get(id) ?? {};
    const offered = pass.offered.get(id) ?? {};
    for (const res of Object.keys(cap) as Resource[]) {
      const c = cap[res]!;
      const load = offered[res] ?? 0;
      if (c === 0 || !Number.isFinite(c) || load === 0) continue;
      const ratio = c / load;
      if (!best || ratio < best.ratio) best = { ratio, nodeId: id, resource: res };
    }
    const node = ctx.g.nodes.get(id)!;
    const load = offered.total ?? 0;
    if (node.type === "api-server") {
      const per = node.config.capacityPerInstance ?? DEFAULTS.apiServerCapacityPerInstance;
      instancesNeeded[id] = Math.ceil(load / (per * TARGET_UTILIZATION) - 1e-9);
    } else if (node.type === "background-worker") {
      const per = node.config.throughputPerInstance ?? DEFAULTS.workerThroughputPerInstance;
      instancesNeeded[id] = Math.ceil(load / (per * TARGET_UTILIZATION) - 1e-9);
    }
  }
  return {
    breakingPointRps: best ? traffic.totalRps * best.ratio : null,
    ...(best ? { firstSaturation: { nodeId: best.nodeId, resource: best.resource } } : {}),
    instancesNeeded,
    targetUtilization: TARGET_UTILIZATION,
  };
}

function detectEvents(
  ctx: Context,
  scenario: FailureScenario,
  pass: Pass,
  nodes: Record<NodeId, NodeResult>,
  success: SuccessModel,
): SimEvent[] {
  const events: SimEvent[] = [];
  const label = (id: NodeId) => ctx.g.nodes.get(id)?.label ?? id;

  for (const [id, r] of Object.entries(nodes)) {
    if (r.status === "down") events.push({ kind: "down", nodeIds: [id], message: `${label(id)} is down.` });
    for (const [res, rr] of Object.entries(r.resources)) {
      if (rr && rr.capacity > 0 && rr.utilization >= 1) {
        const what = res === "total" ? "" : ` (${res}s)`;
        events.push({ kind: "saturated", nodeIds: [id], message: `${label(id)}${what} is saturated at ${pct(rr.utilization)} of capacity.` });
      }
    }
    if (r.queue && r.queue.backlogGrowthPerSec > 1e-9) {
      events.push({ kind: "backlog-growing", nodeIds: [id], message: `${label(id)} backlog grows by ${fmt(r.queue.backlogGrowthPerSec)} messages/s.` });
      if (r.queue.secondsToFull !== undefined) {
        events.push({
          kind: "unmodeled",
          nodeIds: [id],
          message: `${label(id)} reaches max depth in ~${fmt(r.queue.secondsToFull)} s. What happens after it fills (rejections, publisher errors) is not modeled.`,
        });
      }
    }
  }

  for (const u of pass.unroutable) {
    events.push({ kind: "unroutable", nodeIds: [u.nodeId], message: `${fmt(u.rate)} rps of "${u.op}" at ${label(u.nodeId)} have no healthy component that handles them.` });
  }

  for (const [queueId, q] of pass.queues) {
    if (q.unassigned > 0) {
      events.push({ kind: "unroutable", nodeIds: [queueId], message: `${fmt(q.unassigned)} messages/s in ${label(queueId)} have no consumer with a flow for them.` });
    }
  }

  // A failed database while another database of the same type serves the same callers: failover is not modeled.
  for (const f of scenario.failures) {
    if (f.kind !== "database-primary-down") continue;
    const failed = ctx.g.nodes.get(f.nodeId);
    if (!failed) continue;
    const callers = ctx.doc.edges.filter((e) => e.target === f.nodeId).map((e) => e.source);
    const siblings = ctx.doc.edges
      .filter((e) => callers.includes(e.source) && e.target !== f.nodeId && ctx.g.nodes.get(e.target)?.type === failed.type)
      .map((e) => e.target);
    for (const s of new Set(siblings)) {
      events.push({
        kind: "unmodeled",
        nodeIds: [f.nodeId, s],
        message: `${label(s)} could take over from ${failed.label}, but replication and failover are not modeled. ${label(s)} receives only the traffic its flows send to it.`,
      });
    }
  }

  // Optional steps that fail: the request still succeeds, but retries/compensation are not modeled.
  for (const n of ctx.doc.nodes) {
    for (const [op, steps] of Object.entries(flowsOf(n))) {
      for (const step of steps) {
        if (step.type === "cache-lookup" || !step.optional) continue;
        const target = ctx.g.edges.get(step.edge)!.target;
        const p = success.steps(n, [{ ...step, optional: false }], op);
        if (p < 1 && (pass.admission.get(n.id)?.total ?? 0) > 0) {
          events.push({
            kind: "unmodeled",
            nodeIds: [n.id, target],
            message: `Optional step "${op}" → ${label(target)} fails for ${pct(1 - p)} of requests. The request still succeeds; retries and stale data are not modeled.`,
          });
        }
      }
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function invalidResult(issues: ValidationIssue[]): SimulationResult {
  return {
    engineVersion: ENGINE_VERSION,
    status: "invalid",
    issues,
    nodes: {},
    edges: {},
    operations: {},
    deliveries: [],
    summary: { offered: 0, processingSucceeded: 0, processingSuccessRate: 0, bottlenecks: [] },
    capacity: null,
    events: [],
    assumptions: ASSUMPTIONS.map((a) => a.id),
  };
}

function clientIssues(client: ArchNode, op: OperationId, ctx: Context): boolean {
  const ops = (client.config as { operations?: OperationId[] }).operations;
  return ops ? ops.includes(op) : ctx.opRates.has(op);
}

function clientShare(c: ArchNode): number {
  return (c.config as { share?: number }).share ?? DEFAULTS.clientShare;
}

function byOp(recs: Inflow[]): Map<OperationId, number> {
  const m = new Map<OperationId, number>();
  for (const r of recs) m.set(r.op, (m.get(r.op) ?? 0) + r.rate);
  return m;
}

function deliveryKey(broker: NodeId, consumer: NodeId, message: OperationId) {
  return `${broker}|${consumer}|${message}`;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const sumRate = (recs: Inflow[]) => sum(recs.map((r) => r.rate));
const fmt = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "∞");
const pct = (n: number) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : "∞");
