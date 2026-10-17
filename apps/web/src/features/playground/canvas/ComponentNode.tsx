import { CATALOG } from "@sdl/architecture";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { CircleAlert, TriangleAlert, Zap } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { ICONS, summarizeConfig } from "../catalogUi";
import { formatPct, STATUS_UI } from "../simulation/simulationUi";
import type { ComponentFlowNode, NodeSimulation } from "./toFlow";

const handleClass = "!size-2.5 !border-2 !border-muted-foreground !bg-background";

function ComponentNodeView({ data, selected }: NodeProps<ComponentFlowNode>) {
  const { node, issueLevel, issueCount, sim } = data;
  const def = CATALOG[node.type];
  const Icon = ICONS[def.icon];
  const role = def.role;
  // Clients only start requests and stores only receive them, so they show one handle.
  const hasTarget = role !== "source";
  const hasSource = role !== "store" && role !== "cache";

  return (
    <div
      className={cn(
        "w-48 rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-sm transition-shadow",
        sim && cn("border-2", STATUS_UI[sim.status].border),
        selected && "border-primary ring-2 ring-primary/30",
        issueLevel === "error" && !selected && !sim && "border-destructive/60",
      )}
    >
      {hasTarget && <Handle type="target" position={Position.Left} className={handleClass} />}
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
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
      {hasSource && <Handle type="source" position={Position.Right} className={handleClass} />}
    </div>
  );
}

function SimulationRow({ sim }: { sim: NodeSimulation }) {
  const ui = STATUS_UI[sim.status];
  const StatusIcon = ui.icon;
  return (
    <div className="mt-2 flex items-center gap-1.5 border-t pt-1.5 text-[11px] leading-none">
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
      {sim.utilization !== undefined && sim.status !== "idle" && (
        <span className="ml-auto font-mono tabular-nums text-muted-foreground" title="Utilization">
          <span className="sr-only">Utilization </span>
          {formatPct(sim.utilization)}
        </span>
      )}
    </div>
  );
}

export const ComponentNode = memo(ComponentNodeView);
