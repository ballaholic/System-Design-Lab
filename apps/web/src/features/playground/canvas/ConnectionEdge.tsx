import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { memo } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { cn } from "@/lib/utils";
import { formatRateShort } from "../simulation/simulationUi";
import type { ConnectionFlowEdge, TrafficTone } from "./toFlow";

const TONE_COLOUR: Record<TrafficTone, string> = {
  flow: "var(--primary)",
  warm: "var(--warning)",
  bad: "var(--destructive)",
};

/** Stroke width for a simulated rate: 1.5 for idle connections up to 6 for the busiest one. */
function simulatedWidth(rate: number, maxRate: number): number {
  return maxRate > 0 && rate > 0 ? 1.5 + 4.5 * Math.sqrt(rate / maxRate) : 1.5;
}

/**
 * Moving dots that show traffic: busier connections get more and faster dots. Purely decorative (the label
 * carries the number), so it's hidden from assistive technology and skipped when motion is reduced.
 */
function TrafficDots({
  path,
  rate,
  maxRate,
  tone,
}: {
  path: string;
  rate: number;
  maxRate: number;
  tone: TrafficTone;
}) {
  const share = Math.sqrt(rate / maxRate);
  const count = 1 + Math.round(share * 3);
  const seconds = 2.8 - 1.8 * share;
  return (
    <g aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <circle key={i} r={2.5 + share} fill={TONE_COLOUR[tone]} opacity={0.9}>
          <animateMotion
            dur={`${seconds}s`}
            begin={`${(-i * seconds) / count}s`}
            repeatCount="indefinite"
            path={path}
          />
        </circle>
      ))}
    </g>
  );
}

/** A new connection draws itself and a spark runs along it once. */
function DrawIn({ path, reducedMotion }: { path: string; reducedMotion: boolean }) {
  return (
    <g aria-hidden>
      <path
        d={path}
        pathLength={1}
        fill="none"
        className="sdl-draw"
        stroke="var(--primary)"
        strokeWidth={4}
        strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 4px var(--primary))" }}
      />
      {!reducedMotion && (
        <circle r={4} fill="var(--primary)" style={{ filter: "drop-shadow(0 0 6px var(--primary))" }}>
          <animateMotion dur="0.6s" repeatCount="1" fill="freeze" path={path} />
          <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.7;1" dur="0.9s" fill="freeze" />
        </circle>
      )}
    </g>
  );
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
  const reducedMotion = usePrefersReducedMotion();
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
              : sim && sim.rate > 0
                ? `oklch(from ${TONE_COLOUR[sim.tone]} l c h / 45%)`
                : undefined,
          opacity: unused && !selected ? 0.6 : 1,
          transition: "stroke-width 300ms ease-out, stroke 300ms ease-out",
        }}
      />
      {sim && sim.rate > 0 && !reducedMotion && (
        <TrafficDots path={path} rate={sim.rate} maxRate={sim.maxRate} tone={sim.tone} />
      )}
      {data?.drawn !== undefined && <DrawIn key={data.drawn} path={path} reducedMotion={reducedMotion} />}
      {text && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "nodrag nopan pointer-events-none absolute max-w-40 truncate rounded border bg-background/90 px-1.5 py-0.5 text-[10px] leading-tight",
              unused ? "text-muted-foreground italic" : "text-foreground",
              sim && "font-mono tabular-nums",
              sim?.tone === "bad" && sim.rate > 0 && "border-destructive/60 text-destructive",
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
