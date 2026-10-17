import { CATALOG } from "@sdl/architecture";
import type { ValidSimulationResult } from "@sdl/simulation";
import { type ReactNode, useId } from "react";
import { useAnimatedNumber } from "@/lib/useAnimatedNumber";
import { cn } from "@/lib/utils";
import { useEditor } from "../store/editorContext";
import { NodeLink } from "./NodeLink";
import { formatPct, formatRate, RESOURCE_LABEL } from "./simulationUi";

export function SummaryTab({ result }: { result: ValidSimulationResult }) {
  const doc = useEditor((s) => s.doc);
  const { summary, capacity } = result;
  const opName = (id: string) => doc.operations.find((o) => o.id === id)?.name ?? id;
  const sentOps = doc.operations.filter((o) => (result.operations[o.id]?.offered ?? 0) > 0);
  const rate = summary.processingSuccessRate;
  const instanceRows = Object.entries(capacity.instancesNeeded).map(([id, needed]) => {
    const node = doc.nodes.find((n) => n.id === id);
    return { id, needed, configured: (node?.config as { instances?: number } | undefined)?.instances ?? 0 };
  });

  return (
    <div className="grid gap-4 p-3 text-sm lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Requests that succeeded</p>
          <p
            className={cn(
              "font-mono text-3xl font-semibold tabular-nums",
              rate >= 0.999 ? "text-success" : rate >= 0.95 ? "text-warning" : "text-destructive",
            )}
          >
            {summary.offered > 0 ? <AnimatedPercent value={rate} /> : "–"}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatRate(summary.processingSucceeded)} of {formatRate(summary.offered)} requests/s
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Breaking point</p>
          {capacity.breakingPointRps === null ? (
            <p>Nothing is constrained.</p>
          ) : (
            <p>
              <span className="font-mono tabular-nums">{formatRate(capacity.breakingPointRps)}</span>{" "}
              requests/s
              {capacity.firstSaturation && (
                <span className="block text-xs text-muted-foreground">
                  First to saturate:{" "}
                  <NodeLink
                    id={capacity.firstSaturation.nodeId}
                    suffix={RESOURCE_LABEL[capacity.firstSaturation.resource] || undefined}
                  />
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      <Block title="Bottlenecks">
        {summary.bottlenecks.length === 0 ? (
          <p className="text-muted-foreground">Every component is below 70% of its capacity.</p>
        ) : (
          <ol className="grid gap-1">
            {summary.bottlenecks.slice(0, 6).map((b) => (
              <li key={`${b.nodeId}-${b.resource}`} className="flex items-center justify-between gap-2">
                <NodeLink id={b.nodeId} suffix={RESOURCE_LABEL[b.resource] || undefined} />
                <span
                  className={cn(
                    "font-mono tabular-nums",
                    b.utilization >= 1 ? "text-destructive" : "text-warning",
                  )}
                >
                  {formatPct(b.utilization)}
                </span>
              </li>
            ))}
          </ol>
        )}
        {instanceRows.length > 0 && (
          <>
            <h4 className="mt-3 text-xs font-medium text-muted-foreground">
              Instances needed at {formatPct(capacity.targetUtilization)} utilization
            </h4>
            <ul className="grid gap-1">
              {instanceRows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2">
                  <NodeLink id={row.id} />
                  <span className="font-mono tabular-nums">
                    <span className={cn(row.needed > row.configured && "text-destructive")}>
                      {row.needed}
                    </span>
                    <span className="text-muted-foreground"> (has {row.configured})</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Block>

      <Block title="Operations">
        {sentOps.length === 0 ? (
          <p className="text-muted-foreground">No client traffic reaches the design.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">Operation</th>
                <th className="py-1 pr-2 text-right font-medium">Offered/s</th>
                <th className="py-1 pr-2 text-right font-medium">Accepted/s</th>
                <th className="py-1 text-right font-medium">Succeeded</th>
              </tr>
            </thead>
            <tbody>
              {sentOps.map((o) => {
                const out = result.operations[o.id]!;
                return (
                  <tr key={o.id} className="border-t">
                    <td className="py-1 pr-2">{o.name}</td>
                    <td className="py-1 pr-2 text-right font-mono tabular-nums">{formatRate(out.offered)}</td>
                    <td className="py-1 pr-2 text-right font-mono tabular-nums">
                      {formatRate(out.accepted)}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {formatPct(out.processingSuccessRate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {result.deliveries.length > 0 && (
          <>
            <h4 className="mt-3 text-xs font-medium text-muted-foreground">Asynchronous delivery</h4>
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Consumer</th>
                  <th className="py-1 pr-2 text-right font-medium">Consumed/s</th>
                  <th className="py-1 pr-2 text-right font-medium">Backlog/s</th>
                  <th className="py-1 text-right font-medium">Succeeded</th>
                </tr>
              </thead>
              <tbody>
                {result.deliveries.map((d) => (
                  <tr key={`${d.brokerId}-${d.consumerId}-${d.message}`} className="border-t">
                    <td className="py-1 pr-2">
                      <NodeLink id={d.consumerId} />
                      <span className="block text-muted-foreground">
                        {opName(d.message)} via{" "}
                        {doc.nodes.find((n) => n.id === d.brokerId)?.label ?? CATALOG["message-queue"].name}
                      </span>
                    </td>
                    <td className="py-1 pr-2 text-right font-mono tabular-nums">
                      {formatRate(d.consumed)}{" "}
                      <span className="text-muted-foreground">of {formatRate(d.inflow)}</span>
                    </td>
                    <td
                      className={cn(
                        "py-1 pr-2 text-right font-mono tabular-nums",
                        d.backlogGrowthPerSec > 0 && "text-destructive",
                      )}
                    >
                      {d.backlogGrowthPerSec > 0 ? `+${formatRate(d.backlogGrowthPerSec)}` : "0"}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {d.consumerSuccessRate === null ? "–" : formatPct(d.consumerSuccessRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {sentOps.some((o) => result.operations[o.id]!.publications.length > 0) && (
          <p className="mt-2 text-xs text-muted-foreground">
            Published:{" "}
            {sentOps
              .flatMap((o) => result.operations[o.id]!.publications)
              .map((p) => `${formatRate(p.published)} of ${formatRate(p.attempted)}/s`)
              .join(", ")}
            . Publishing isn&apos;t delivery.
          </p>
        )}
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid content-start gap-1.5">
      <h3 id={id} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Counts up to the success rate, so a fix feels like one. Screen readers get the final value only. */
function AnimatedPercent({ value }: { value: number }) {
  const shown = useAnimatedNumber(value);
  return (
    <>
      <span aria-hidden>{formatPct(shown)}</span>
      <span className="sr-only">{formatPct(value)}</span>
    </>
  );
}
