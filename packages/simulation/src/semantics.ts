// What the engine does per component, as data (ARCHITECTURE §6.4). The "How the simulator works" page and
// the AI capability summary are generated from this, so the description can't drift from the engine.

import type { ComponentRole, ComponentType } from "@sdl/architecture";
import type { NodeStatus, SimEventKind } from "./types";

export interface RoleSemantics {
  role: ComponentRole;
  title: string;
  types: readonly ComponentType[];
  capacity: string;
  behaviour: string;
  success: string;
  notModeled: readonly string[];
}

export const ROLE_SEMANTICS: readonly RoleSemantics[] = [
  {
    role: "source",
    title: "Clients",
    types: ["web-client", "mobile-client"],
    capacity: "Unlimited.",
    behaviour:
      "Each client sends its share of every operation it sends (traffic share relative to the other clients sending it), split evenly across the connected components that can handle it.",
    success:
      "Average success of the components it sends to. 0 if nothing can handle the operation (unroutable).",
    notModeled: ["Client retries", "Think time and sessions"],
  },
  {
    role: "distributor",
    title: "Load balancer and API gateway",
    types: ["load-balancer", "api-gateway"],
    capacity:
      "Capacity in requests/s. A gateway's optional rate limit lowers it; those rejections are reported as rate-limited.",
    behaviour:
      "Admits up to capacity, then splits each operation evenly across the targets that can handle it. Targets that are fully down are skipped (health checks).",
    success: "Admission fraction × average success of its targets.",
    notModeled: [
      "Balancing algorithms other than an even split",
      "Sticky sessions and connection limits",
      "Authentication, request transformation and per-client limits",
    ],
  },
  {
    role: "edge-cache",
    title: "CDN",
    types: ["cdn"],
    capacity: "Capacity in requests/s.",
    behaviour:
      "Admits up to capacity. For cacheable operations (all read operations unless you choose), the hit rate is served at the edge and misses are forwarded like a load balancer. Other operations are forwarded entirely.",
    success:
      "Cacheable: admission × (hit rate + miss rate × target success). Other: admission × target success.",
    notModeled: ["TTLs and invalidation", "Geographic distribution"],
  },
  {
    role: "service",
    title: "API server",
    types: ["api-server"],
    capacity: "Healthy instances × capacity per instance, in requests/s.",
    behaviour:
      "Admits up to capacity, then runs its flow for each operation on the admitted load. Every step is attempted, even after an earlier one failed, so downstream load is an upper bound.",
    success: "Admission fraction × success of every required step.",
    notModeled: ["Autoscaling", "Threads and connection pools", "Warm-up"],
  },
  {
    role: "consumer",
    title: "Background worker",
    types: ["background-worker"],
    capacity:
      "Instances × throughput per instance, in messages/s. Reading from an event stream, it can't use more instances than the stream has partitions.",
    behaviour:
      "Consumes messages from queues and streams and runs its flow for each message. Workers never reject: messages they can't consume stay in the backlog.",
    success:
      "Success of every required step, for consumed messages. Shown as unknown when nothing is consumed.",
    notModeled: ["Retries and dead-letter queues", "Poison messages", "Ordering"],
  },
  {
    role: "cache",
    title: "Cache",
    types: ["redis-cache"],
    capacity: "Operations/s: lookups, calls and fills on miss.",
    behaviour:
      "A cache lookup step hits at the configured hit rate; rejected lookups count as misses and run the on-miss steps. With populate on, every miss adds a best-effort fill that only uses leftover capacity.",
    success:
      "Lookup step: effective hit rate + misses × on-miss success. A call to the cache: its admission fraction.",
    notModeled: ["Eviction and memory size", "TTLs", "Hit rate derived from data (it's an input)"],
  },
  {
    role: "store",
    title: "Databases and object storage",
    types: ["sql-database", "nosql-database", "object-storage"],
    capacity: "Separate read and write capacity.",
    behaviour:
      "A call uses read or write capacity according to the step's setting or the operation's kind. Load above capacity is rejected.",
    success: "Admission fraction of the resource used.",
    notModeled: ["Replication and failover", "Locks and query cost", "Storage size", "Consistency"],
  },
  {
    role: "queue",
    title: "Message queue",
    types: ["message-queue"],
    capacity: "Enqueue capacity in messages/s.",
    behaviour:
      "Accepts published messages up to capacity. Consumers compete: each message goes to one worker, in proportion to worker capacity. Messages that aren't consumed add to the backlog.",
    success: "A publish step succeeds when the queue accepts the message. Publishing isn't delivery.",
    notModeled: ["What happens once the queue is full", "Visibility timeouts", "Ordering"],
  },
  {
    role: "stream",
    title: "Event stream",
    types: ["event-stream"],
    capacity: "Ingest capacity in messages/s.",
    behaviour:
      "Accepts published messages up to capacity. Every consumer group (each connected worker) receives every message. Unread messages add to that group's lag.",
    success: "A publish step succeeds when the stream accepts the message.",
    notModeled: ["Partition skew", "Retention limits", "Rebalancing", "Exactly-once delivery"],
  },
];

export const STATUS_DESCRIPTIONS: Record<NodeStatus, { label: string; description: string }> = {
  ok: { label: "OK", description: "Below 70% of capacity." },
  warm: { label: "Warm", description: "70% of capacity or more. Little headroom left." },
  saturated: {
    label: "Saturated",
    description: "At or above capacity: excess load is rejected (or, for workers, waits).",
  },
  down: { label: "Down", description: "Failed by an injected failure, or no healthy instances left." },
  idle: { label: "Idle", description: "Receives no traffic." },
};

export const EVENT_DESCRIPTIONS: Record<SimEventKind, string> = {
  saturated: "A component is at or above capacity.",
  "rate-limited": "A gateway's rate limit rejects requests.",
  down: "A component is down.",
  unroutable: "Traffic has nowhere healthy to go.",
  "backlog-growing": "Consumers don't keep up, so the backlog or lag grows.",
  idle: "A connected component receives no traffic.",
  unmodeled: "The design implies behaviour the simulator doesn't model, so it says so instead of guessing.",
};

export const OUTCOME_DESCRIPTIONS = [
  { term: "Accepted", description: "Requests admitted by the first component after the client." },
  {
    term: "Processing succeeded",
    description:
      "Requests whose synchronous flow completed: every required step succeeded, including the broker accepting required publishes.",
  },
  { term: "Published", description: "Messages accepted by a queue or stream. Publishing isn't delivery." },
  {
    term: "Delivered",
    description:
      "Messages consumed by each worker, and the share of those whose flow succeeded. Unconsumed messages stay in the backlog; they aren't failures.",
  },
] as const;
