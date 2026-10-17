import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import type { ConnectionFlowEdge } from "./toFlow";

function ConnectionEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<ConnectionFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const unused = (data?.carries.length ?? 0) === 0;
  const text = data?.label ?? (unused ? "no traffic" : data?.carries.join(", "));

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: data?.async ? "6 4" : unused ? "2 4" : undefined,
          stroke: selected
            ? "var(--primary)"
            : data?.issueLevel === "error"
              ? "var(--destructive)"
              : undefined,
          opacity: unused && !selected ? 0.6 : 1,
        }}
      />
      {text && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "nodrag nopan pointer-events-none absolute max-w-40 truncate rounded border bg-background/90 px-1.5 py-0.5 text-[10px] leading-tight",
              unused ? "text-muted-foreground italic" : "text-foreground",
              selected && "border-primary",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data?.async && <span className="text-muted-foreground">async · </span>}
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ConnectionEdge = memo(ConnectionEdgeView);
