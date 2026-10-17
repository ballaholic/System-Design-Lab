import { CATALOG, EDGE_SIDES, type EdgeSide } from "@sdl/architecture";
import type { NodeStatus } from "@sdl/simulation";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { CircleAlert, TriangleAlert, Zap } from "lucide-react";
import { type CSSProperties, memo, useState } from "react";
import { cn } from "@/lib/utils";
import { CATEGORY_TINT, ICONS, summarizeConfig } from "../catalogUi";
import { formatPct, STATUS_UI } from "../simulation/simulationUi";
import type { ComponentFlowNode, NodeSimulation } from "./toFlow";

const handleClass =
  "!size-2.5 !rounded-full !border-2 !border-muted-foreground !bg-background transition-transform hover:!scale-150 hover:!border-primary group-hover:!border-primary/70";

const HANDLE_POSITION: Record<EdgeSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

const GLOW: Partial<Record<NodeStatus, string>> = {
  ok: "shadow-[0_0_16px_-6px_var(--success)]",
  warm: "shadow-[0_0_16px_-4px_var(--warning)]",
};

const isBad = (s: NodeStatus | undefined) => s === "saturated" || s === "down";
const isGood = (s: NodeStatus | undefined) => s === "ok" || s === "warm";

/**
 * Counts status changes worth acknowledging: recovering (saturated or down → ok or warm) and breaking (the
 * reverse). Each count is a key that replays a one-off ring animation. Uses the "adjust state during render"
 * pattern, so no effect or timer is needed.
 */
function useStatusFlashes(status: NodeStatus | undefined) {
  const [previous, setPrevious] = useState(status);
  const [flash, setFlash] = useState<{ kind: "recovered" | "broke"; count: number } | null>(null);
  if (status !== previous) {
    setPrevious(status);
    if (isBad(previous) && isGood(status))
      setFlash((f) => ({ kind: "recovered", count: (f?.count ?? 0) + 1 }));
    else if (isGood(previous) && isBad(status))
      setFlash((f) => ({ kind: "broke", count: (f?.count ?? 0) + 1 }));
  }
  return flash;
}

function ComponentNodeView({ data, selected }: NodeProps<ComponentFlowNode>) {
  const { node, issueLevel, issueCount, sim, pulse } = data;
  const def = CATALOG[node.type];
  const Icon = ICONS[def.icon];
  const role = def.role;
  // Connections come in on the left, go out on the right, and use top and bottom both ways (the canvas uses loose
  // connection mode). Dragging from a box that sends requests makes it the source; stores and caches only
  // receive, so dragging from one makes it the target. Neither may start a drag from the side it can't use.
  const handleType = role === "store" || role === "cache" ? "target" : "source";
  const flash = useStatusFlashes(sim?.status);

  return (
    <div
      className={cn(
        "group sdl-pop-in relative w-48 rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-sm transition-[box-shadow,border-color] duration-300",
        sim && cn("border-2", STATUS_UI[sim.status].border, GLOW[sim.status]),
        sim?.status === "saturated" && "sdl-breathe",
        selected && "border-primary ring-2 ring-primary/30",
        issueLevel === "error" && !selected && !sim && "border-destructive/60",
      )}
    >
      {pulse !== undefined && <span key={`pulse-${pulse}`} className="sdl-ring" aria-hidden />}
      {flash && (
        <span
          key={`${flash.kind}-${flash.count}`}
          className="sdl-ring"
          style={
            {
              "--ring-color": flash.kind === "recovered" ? "var(--success)" : "var(--destructive)",
            } as CSSProperties
          }
          aria-hidden
        />
      )}
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            CATEGORY_TINT[def.category],
          )}
        >
          <Icon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight" title={node.label}>
            {node.label}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            <span className="sr-only">{def.name}: </span>
            {summarizeConfig(node)}
          </div>
        </div>
        {issueLevel && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-xs",
              issueLevel === "error" ? "text-destructive" : "text-warning",
            )}
            title={`${issueCount} ${issueLevel === "error" ? "problem" : "warning"}${issueCount === 1 ? "" : "s"}`}
          >
            {issueLevel === "error" ? (
              <CircleAlert className="size-3.5" aria-hidden />
            ) : (
              <TriangleAlert className="size-3.5" aria-hidden />
            )}
            <span className="sr-only">{issueLevel === "error" ? "Has problems" : "Has warnings"}</span>
          </span>
        )}
      </div>
      {sim && <SimulationRow sim={sim} />}
      {EDGE_SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type={handleType}
          position={HANDLE_POSITION[side]}
          isConnectableStart={side !== (handleType === "source" ? "left" : "right")}
          className={handleClass}
        />
      ))}
    </div>
  );
}

function SimulationRow({ sim }: { sim: NodeSimulation }) {
  const ui = STATUS_UI[sim.status];
  const StatusIcon = ui.icon;
  const utilization = sim.utilization !== undefined && sim.status !== "idle" ? sim.utilization : undefined;
  return (
    <div className="sdl-slide-up mt-2 grid gap-1 border-t pt-1.5 text-[11px] leading-none">
      <div className="flex items-center gap-1.5">
        <span className={cn("flex items-center gap-1 font-medium", ui.text)}>
          <StatusIcon className="size-3.5" aria-hidden />
          {ui.label}
        </span>
        {sim.failed && (
          <span className="flex items-center gap-0.5 text-destructive" title="Failure injected">
            <Zap className="size-3" aria-hidden />
            <span className="sr-only">Failure injected</span>
          </span>
        )}
        {utilization !== undefined && (
          <span className="ml-auto font-mono tabular-nums text-muted-foreground" title="Utilization">
            <span className="sr-only">Utilization </span>
            {formatPct(utilization)}
          </span>
        )}
      </div>
      {utilization !== undefined && (
        <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out",
              utilization >= 1 ? "bg-destructive" : utilization >= 0.7 ? "bg-warning" : "bg-success",
            )}
            style={{ width: `${Math.min(100, utilization * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export const ComponentNode = memo(ComponentNodeView);
