import type { z } from "zod";
import { decimal, type FieldMeta, integer, operationList, optionalInteger, ratio } from "./fields";

// Defaults are illustrative orders of magnitude, not benchmarks (ADR-020, ARCHITECTURE §6.10).

export type ComponentCategory = "client" | "application" | "storage" | "caching" | "messaging";

/**
 * Drives connection rules here and routing in the simulator (ARCHITECTURE §6.4). A background worker is a
 * service that only consumes messages, so it gets its own role.
 */
export type ComponentRole =
  "source" | "distributor" | "edge-cache" | "service" | "consumer" | "cache" | "store" | "queue" | "stream";

/** Icon names resolved to lucide icons by the web app. */
export type IconKey =
  | "monitor"
  | "smartphone"
  | "shield"
  | "split"
  | "server"
  | "cog"
  | "database"
  | "table"
  | "archive"
  | "zap"
  | "globe"
  | "inbox"
  | "activity";

const MAX_RATE = 100_000_000;
const MAX_INSTANCES = 1000;

const clientFields = {
  share: decimal({
    label: "Traffic share",
    help: "Relative weight of this client's traffic when there are several clients. Two clients with share 1 each send half of the traffic each.",
    min: 0,
    max: 1000,
    default: 1,
  }),
  operations: operationList({
    label: "Operations sent",
    help: "Which operations this client sends. Clients that don't send an operation get none of its traffic.",
    whenUnset: "All operations",
  }),
};

const storeFields = (read: number, write: number) => ({
  readCapacity: integer({
    label: "Read capacity",
    unit: "reads/s",
    help: "Reads per second this store can serve. Reads beyond this are rejected (load shedding).",
    min: 1,
    max: MAX_RATE,
    default: read,
  }),
  writeCapacity: integer({
    label: "Write capacity",
    unit: "writes/s",
    help: "Writes per second this store can accept. Reads and writes are counted separately.",
    min: 1,
    max: MAX_RATE,
    default: write,
  }),
});

export const COMPONENTS = {
  "web-client": {
    category: "client",
    role: "source",
    name: "Web client",
    description: "Browsers sending requests. Traffic starts at clients.",
    icon: "monitor",
    fields: clientFields,
  },
  "mobile-client": {
    category: "client",
    role: "source",
    name: "Mobile client",
    description: "Mobile apps sending requests. Traffic starts at clients.",
    icon: "smartphone",
    fields: clientFields,
  },
  "api-gateway": {
    category: "application",
    role: "distributor",
    name: "API gateway",
    description:
      "Single entry point that routes each operation to the services that handle it, with optional rate limiting.",
    icon: "shield",
    fields: {
      capacityRps: integer({
        label: "Capacity",
        unit: "rps",
        help: "Requests per second the gateway can forward. Excess requests are rejected.",
        min: 1,
        max: MAX_RATE,
        default: 50_000,
      }),
      rateLimitRps: optionalInteger({
        label: "Rate limit",
        unit: "rps",
        help: "Optional cap on accepted requests. Requests over the limit are rejected and reported as rate-limited. Leave empty for no limit.",
        min: 1,
        max: MAX_RATE,
      }),
    },
  },
  "load-balancer": {
    category: "application",
    role: "distributor",
    name: "Load balancer",
    description: "Spreads requests evenly across the servers behind it that can handle them.",
    icon: "split",
    fields: {
      capacityRps: integer({
        label: "Capacity",
        unit: "rps",
        help: "Requests per second the load balancer can forward. Excess requests are rejected.",
        min: 1,
        max: MAX_RATE,
        default: 50_000,
      }),
    },
  },
  "api-server": {
    category: "application",
    role: "service",
    name: "API server",
    description: "Stateless application servers. Its flows define what it does for each operation.",
    icon: "server",
    fields: {
      instances: integer({
        label: "Instances",
        help: "Number of identical server instances. Total capacity is instances × capacity per instance.",
        min: 1,
        max: MAX_INSTANCES,
        default: 2,
      }),
      capacityPerInstanceRps: integer({
        label: "Capacity per instance",
        unit: "rps",
        help: "Requests per second one instance can handle.",
        min: 1,
        max: MAX_RATE,
        default: 1000,
      }),
    },
  },
  "background-worker": {
    category: "application",
    role: "consumer",
    name: "Background worker",
    description: "Consumes messages from a queue or stream and processes them with its flows.",
    icon: "cog",
    fields: {
      instances: integer({
        label: "Instances",
        help: "Number of worker instances consuming in parallel.",
        min: 1,
        max: MAX_INSTANCES,
        default: 1,
      }),
      throughputPerInstance: integer({
        label: "Throughput per instance",
        unit: "msg/s",
        help: "Messages per second one instance can process. Messages beyond this wait in the backlog.",
        min: 1,
        max: MAX_RATE,
        default: 200,
      }),
    },
  },
  "sql-database": {
    category: "storage",
    role: "store",
    name: "SQL database",
    description: "Relational database such as PostgreSQL. Separate read and write capacity.",
    icon: "database",
    fields: storeFields(5000, 2000),
  },
  "nosql-database": {
    category: "storage",
    role: "store",
    name: "NoSQL database",
    description: "Key-value or document store, typically with higher throughput than SQL.",
    icon: "table",
    fields: storeFields(20_000, 10_000),
  },
  "object-storage": {
    category: "storage",
    role: "store",
    name: "Object storage",
    description: "Blob storage such as S3. Effectively high capacity for most designs.",
    icon: "archive",
    fields: storeFields(50_000, 10_000),
  },
  "redis-cache": {
    category: "caching",
    role: "cache",
    name: "Cache",
    description: "In-memory cache such as Redis. Use a cache lookup step to serve reads from it.",
    icon: "zap",
    fields: {
      hitRate: ratio({
        label: "Hit rate",
        help: "Fraction of lookups found in the cache. This is an input you choose, not derived from data size or TTL.",
        default: 0.8,
      }),
      capacityOps: integer({
        label: "Capacity",
        unit: "ops/s",
        help: "Cache operations per second: lookups, writes and populates on miss.",
        min: 1,
        max: MAX_RATE,
        default: 100_000,
      }),
    },
  },
  cdn: {
    category: "caching",
    role: "edge-cache",
    name: "CDN",
    description:
      "Edge cache in front of your servers. Serves cacheable operations at the edge and forwards misses.",
    icon: "globe",
    fields: {
      hitRate: ratio({
        label: "Hit rate",
        help: "Fraction of cacheable requests served at the edge. Misses are forwarded to the servers behind the CDN.",
        default: 0.9,
      }),
      cacheableOperations: operationList({
        label: "Cacheable operations",
        help: "Operations the CDN may serve from its cache. Other operations are always forwarded.",
        whenUnset: "All read operations",
      }),
      capacityRps: integer({
        label: "Capacity",
        unit: "rps",
        help: "Requests per second the CDN can accept.",
        min: 1,
        max: MAX_RATE,
        default: 1_000_000,
      }),
    },
  },
  "message-queue": {
    category: "messaging",
    role: "queue",
    name: "Message queue",
    description: "Buffers messages for background workers. Workers compete: each message goes to one worker.",
    icon: "inbox",
    fields: {
      enqueueCapacity: integer({
        label: "Enqueue capacity",
        unit: "msg/s",
        help: "Messages per second the queue accepts from publishers.",
        min: 1,
        max: MAX_RATE,
        default: 50_000,
      }),
      maxDepth: optionalInteger({
        label: "Max depth",
        unit: "messages",
        help: "Optional backlog limit, used to report time until the queue is full. Leave empty for unbounded.",
        min: 1,
        max: 1_000_000_000,
      }),
    },
  },
  "event-stream": {
    category: "messaging",
    role: "stream",
    name: "Event stream",
    description: "Append-only log such as Kafka. Every consumer group receives every message.",
    icon: "activity",
    fields: {
      ingestCapacity: integer({
        label: "Ingest capacity",
        unit: "msg/s",
        help: "Messages per second the stream accepts from publishers.",
        min: 1,
        max: MAX_RATE,
        default: 100_000,
      }),
      partitions: integer({
        label: "Partitions",
        help: "Parallelism of the stream. A consumer can't use more instances than there are partitions.",
        min: 1,
        max: 1024,
        default: 8,
      }),
    },
  },
} as const satisfies Record<
  string,
  {
    category: ComponentCategory;
    role: ComponentRole;
    name: string;
    description: string;
    icon: IconKey;
    fields: Record<string, { schema: z.ZodType; meta: FieldMeta }>;
  }
>;

export type ComponentType = keyof typeof COMPONENTS;

type OperationIds = string[];

/** Normalized config per component type (defaults applied). Kept in step with `COMPONENTS` by the catalog tests. */
export interface ComponentConfigs {
  "web-client": { share: number; operations?: OperationIds };
  "mobile-client": { share: number; operations?: OperationIds };
  "api-gateway": { capacityRps: number; rateLimitRps?: number };
  "load-balancer": { capacityRps: number };
  "api-server": { instances: number; capacityPerInstanceRps: number };
  "background-worker": { instances: number; throughputPerInstance: number };
  "sql-database": { readCapacity: number; writeCapacity: number };
  "nosql-database": { readCapacity: number; writeCapacity: number };
  "object-storage": { readCapacity: number; writeCapacity: number };
  "redis-cache": { hitRate: number; capacityOps: number };
  cdn: { hitRate: number; cacheableOperations?: OperationIds; capacityRps: number };
  "message-queue": { enqueueCapacity: number; maxDepth?: number };
  "event-stream": { ingestCapacity: number; partitions: number };
}
