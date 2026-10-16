// Prints the URL Shortener stage lessons: `npm run report`.

import { simulate } from "./engine.js";
import type { ArchitectureDocument, FailureScenario, SimulationResult, TrafficProfile } from "./model.js";
import { notificationPipeline, urlShortenerNoCache, urlShortenerWithCache, urlShortenerWithIdleReplica } from "./scenarios.js";

const n = (x: number) => Math.round(x).toLocaleString("en-US");
const p = (x: number) => `${(x * 100).toFixed(1)}%`;

function show(title: string, doc: ArchitectureDocument, traffic: TrafficProfile, scenario?: FailureScenario) {
  const r: SimulationResult = simulate(doc, traffic, scenario);
  console.log(`\n=== ${title} ===`);
  if (r.status === "invalid") {
    r.issues.forEach((i) => console.log(`  [${i.severity}] ${i.message}`));
    return;
  }
  console.log(`  traffic ${n(traffic.totalRps)} rps · overall processing success ${p(r.summary.processingSuccessRate)}`);
  for (const [op, o] of Object.entries(r.operations)) {
    if (o.offered === 0) continue;
    const pubs = o.publications.map((x) => ` · published ${n(x.published)}/${n(x.attempted)} to ${x.queueId}`).join("");
    console.log(`  ${op.padEnd(9)} offered ${n(o.offered).padStart(6)} · accepted ${n(o.accepted).padStart(6)} · succeeded ${p(o.processingSuccessRate)}${pubs}`);
  }
  for (const d of r.deliveries) {
    console.log(`  delivery ${d.brokerId}→${d.consumerId}: consumed ${n(d.consumed)}/${n(d.inflow)} msg/s · backlog +${n(d.backlogGrowthPerSec)}/s · consumer success ${d.consumerSuccessRate === null ? "n/a" : p(d.consumerSuccessRate)}`);
  }
  for (const [id, node] of Object.entries(r.nodes)) {
    if (node.explanation.length === 0 && node.status === "idle") continue;
    console.log(`  - ${id} [${node.status}] ${node.explanation.join(" ")}`);
  }
  const c = r.capacity!;
  if (c.breakingPointRps !== null) {
    console.log(`  capacity: breaks at ~${n(c.breakingPointRps)} rps (first: ${c.firstSaturation!.nodeId} ${c.firstSaturation!.resource}); instances needed @70%: ${JSON.stringify(c.instancesNeeded)}`);
  }
  r.events.forEach((e) => console.log(`  ! ${e.kind}: ${e.message}`));
  r.issues.forEach((i) => console.log(`  ? ${i.severity}: ${i.message}`));
}

show("Stage 1 — baseline", urlShortenerNoCache(2), { totalRps: 110 });
show("Stage 2 — 11k rps, no cache", urlShortenerNoCache(16), { totalRps: 11_000 });
show("Stage 2 — 11k rps, Redis cache-aside (80% hits)", urlShortenerWithCache(16, 0.8), { totalRps: 11_000 });
show("Stage 3 — primary DB down", urlShortenerWithCache(16, 0.8), { totalRps: 11_000 }, { failures: [{ kind: "database-primary-down", nodeId: "db" }] });
show("Stage 3 — primary DB down, unused replica connected", urlShortenerWithIdleReplica(16), { totalRps: 11_000 }, { failures: [{ kind: "database-primary-down", nodeId: "db" }] });
show("Cache down", urlShortenerWithCache(16, 0.8), { totalRps: 11_000 }, { failures: [{ kind: "cache-down", nodeId: "cache" }] });
show("Async — worker down", notificationPipeline(10), { totalRps: 1_000 }, { failures: [{ kind: "worker-down", nodeId: "worker" }] });
