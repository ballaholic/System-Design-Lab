import { type ArchNode, CATALOG, type ComponentCategory, type IconKey } from "@sdl/architecture";
import {
  Activity,
  Archive,
  Cog,
  Database,
  Globe,
  Inbox,
  type LucideIcon,
  Monitor,
  Server,
  Shield,
  Smartphone,
  Split,
  Table2,
  Zap,
} from "lucide-react";

export const ICONS: Record<IconKey, LucideIcon> = {
  monitor: Monitor,
  smartphone: Smartphone,
  shield: Shield,
  split: Split,
  server: Server,
  cog: Cog,
  database: Database,
  table: Table2,
  archive: Archive,
  zap: Zap,
  globe: Globe,
  inbox: Inbox,
  activity: Activity,
};

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export const formatNumber = (n: number) => numberFormat.format(n);
export const formatCompact = (n: number) => compactFormat.format(n);
export const formatPercent = (ratio: number) => `${numberFormat.format(Math.round(ratio * 1000) / 10)}%`;

/** One-line summary of a node's key settings, shown on the canvas. */
export function summarizeConfig(node: ArchNode): string {
  const c = node.config as Record<string, number | string[] | undefined>;
  switch (node.type) {
    case "web-client":
    case "mobile-client":
      return `share ${formatNumber(c.share as number)}`;
    case "api-server":
      return `${c.instances} × ${formatCompact(c.capacityPerInstanceRps as number)} rps`;
    case "background-worker":
      return `${c.instances} × ${formatCompact(c.throughputPerInstance as number)} msg/s`;
    case "load-balancer":
      return `${formatCompact(c.capacityRps as number)} rps`;
    case "api-gateway":
      return c.rateLimitRps === undefined
        ? `${formatCompact(c.capacityRps as number)} rps`
        : `${formatCompact(c.capacityRps as number)} rps · limit ${formatCompact(c.rateLimitRps as number)}`;
    case "sql-database":
    case "nosql-database":
    case "object-storage":
      return `${formatCompact(c.readCapacity as number)} r/s · ${formatCompact(c.writeCapacity as number)} w/s`;
    case "redis-cache":
      return `${formatPercent(c.hitRate as number)} hits · ${formatCompact(c.capacityOps as number)} ops/s`;
    case "cdn":
      return `${formatPercent(c.hitRate as number)} hits`;
    case "message-queue":
      return `${formatCompact(c.enqueueCapacity as number)} msg/s`;
    case "event-stream":
      return `${formatCompact(c.ingestCapacity as number)} msg/s · ${c.partitions} partitions`;
  }
}

export function componentName(node: ArchNode): string {
  return CATALOG[node.type].name;
}

/** Icon tile colours per category, so a design reads at a glance. Colour is decorative here: names say it all. */
export const CATEGORY_TINT: Record<ComponentCategory, string> = {
  client: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  application: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  caching: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  storage: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  messaging: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
};
