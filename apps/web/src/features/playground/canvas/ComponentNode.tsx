import { CATALOG } from "@sdl/architecture";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { ICONS, summarizeConfig } from "../catalogUi";
import type { ComponentFlowNode } from "./toFlow";

const handleClass = "!size-2.5 !border-2 !border-muted-foreground !bg-background";

function ComponentNodeView({ data, selected }: NodeProps<ComponentFlowNode>) {
  const { node, issueLevel, issueCount } = data;
  const def = CATALOG[node.type];
  const Icon = ICONS[def.icon];
  const role = def.role;
  // Clients only start requests and stores only receive them, so they show one handle.
  const hasTarget = role !== "source";
  const hasSource = role !== "store" && role !== "cache";

  return (
    <div
      className={cn(
        "flex w-48 items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-sm transition-shadow",
        selected && "border-primary ring-2 ring-primary/30",
        issueLevel === "error" && !selected && "border-destructive/60",
      )}
    >
      {hasTarget && <Handle type="target" position={Position.Left} className={handleClass} />}
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
      {/* Status slot: validation now, simulation status in Phase 3. */}
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
      {hasSource && <Handle type="source" position={Position.Right} className={handleClass} />}
    </div>
  );
}

export const ComponentNode = memo(ComponentNodeView);
