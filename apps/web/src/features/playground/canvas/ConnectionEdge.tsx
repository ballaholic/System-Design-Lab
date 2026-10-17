import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { formatRateShort } from "../simulation/simulationUi";
import type { ConnectionFlowEdge } from "./toFlow";

/** Stroke width for a simulated rate: 1.5 for idle connections up to 6 for the busiest one. */
function simulatedWidth(rate: number, maxRate: number): number {
  return maxRate > 0 && rate > 0 ? 1.5 + 4.5 * Math.sqrt(rate / maxRate) : 1.5;
}

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
  const sim = data?.sim;
  const unused = sim ? sim.rate === 0 : (data?.carries.length ?? 0) === 0;
  const text = sim
    ? sim.rate === 0
      ? "0/s"
      : formatRateShort(sim.rate)
    : (data?.label ?? (unused ? "no traffic" : data?.carries.join(", ")));
  const width = sim ? simulatedWidth(sim.rate, sim.maxRate) : 1.5;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          strokeWidth: selected ? width + 1 : width,
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
              sim && "font-mono tabular-nums",
              selected && "border-primary",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data?.async && <span className="font-sans text-muted-foreground">async · </span>}
            {sim && <span className="sr-only">Throughput </span>}
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ConnectionEdge = memo(ConnectionEdgeView);
