// Component roles, illustrative defaults and connection rules (ARCHITECTURE §6.4, §6.10).

import type { ComponentType } from "./model.js";

export type Role = "source" | "distributor" | "service" | "consumer" | "cache" | "store" | "queue";

export const ROLE: Record<ComponentType, Role> = {
  "web-client": "source",
  "mobile-client": "source",
  "load-balancer": "distributor",
  "api-server": "service",
  "background-worker": "consumer",
  "redis-cache": "cache",
  "sql-database": "store",
  "message-queue": "queue",
};

/** Illustrative order-of-magnitude defaults (A-ILLUSTRATIVE-CAPACITY). Not benchmarks. */
export const DEFAULTS = {
  loadBalancerCapacityRps: 50_000,
  apiServerInstances: 2,
  apiServerCapacityPerInstance: 1_000,
  workerInstances: 1,
  workerThroughputPerInstance: 200,
  cacheCapacityOps: 100_000,
  cacheHitRate: 0.8,
  sqlReadCapacity: 5_000,
  sqlWriteCapacity: 2_000,
  queueEnqueueCapacity: 50_000,
  clientShare: 1,
} as const;

/** Which component types each type may connect to. */
export const CAN_TARGET: Record<ComponentType, readonly ComponentType[]> = {
  "web-client": ["load-balancer", "api-server"],
  "mobile-client": ["load-balancer", "api-server"],
  "load-balancer": ["load-balancer", "api-server"],
  "api-server": ["api-server", "load-balancer", "redis-cache", "sql-database", "message-queue"],
  "background-worker": ["api-server", "load-balancer", "redis-cache", "sql-database", "message-queue"],
  "message-queue": ["background-worker"],
  "redis-cache": [],
  "sql-database": [],
};

export const HAS_FLOWS: ReadonlySet<Role> = new Set<Role>(["service", "consumer"]);

export const TARGET_UTILIZATION = 0.7;
export const WARM_UTILIZATION = 0.7;
