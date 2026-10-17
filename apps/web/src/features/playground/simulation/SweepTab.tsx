import { sweep } from "@sdl/simulation";
import { useMemo } from "react";
import { useEditor } from "../store/editorContext";
import { NodeLink } from "./NodeLink";
import { formatPct, formatRate, RESOURCE_LABEL, trafficOf } from "./simulationUi";

const W = 640;
const H = 200;
const PAD = { left: 40, right: 12, top: 10, bottom: 28 };
const SERIES_COLOURS = ["var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** Success rate across a range of traffic, from the same engine (SIM-5). */
export function SweepTab() {
  const doc = useEditor((s) => s.doc);
  const scenario = useEditor((s) => s.scenario);
  const traffic = trafficOf(doc);
  const result = useMemo(() => sweep(doc, traffic, scenario), [doc, traffic, scenario]);
  if (result.status !== "ok" || result.points.length === 0) return null;

  const { points, breakingPointRps } = result;
  const maxRps = points.at(-1)!.rps;
  const x = (rps: number) => PAD.left + (rps / maxRps) * (W - PAD.left - PAD.right);
  const y = (rate: number) => PAD.top + (1 - rate) * (H - PAD.top - PAD.bottom);
  const line = (rates: number[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.rps).toFixed(1)},${y(rates[i]!).toFixed(1)}`).join(" ");
  const ops = doc.operations.filter((o) => points[0]!.operations[o.id] !== undefined);
  const firstSaturated = points.find((p) => p.firstSaturated);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxRps);

  return (
    <div className="grid gap-3 p-3 text-sm lg:grid-cols-[minmax(0,1fr)_16rem]">
      <figure className="min-w-0">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full max-w-3xl overflow-visible text-muted-foreground"
          role="img"
          aria-labelledby="sweep-title"
          aria-describedby="sweep-desc"
        >
          <title id="sweep-title">Success rate by total traffic</title>
          <desc id="sweep-desc">
            {breakingPointRps === null
              ? "Nothing saturates in this range."
              : `Success stays at 100% up to about ${formatRate(breakingPointRps)} requests per second, then falls.`}
          </desc>
          {[0, 0.25, 0.5, 0.75, 1].map((r) => (
            <g key={r}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(r)} y2={y(r)} stroke="var(--border)" />
              <text x={PAD.left - 6} y={y(r) + 3} textAnchor="end" fontSize="10" fill="currentColor">
                {r * 100}%
              </text>
            </g>
          ))}
          {xTicks.map((rps) => (
            <text key={rps} x={x(rps)} y={H - 10} textAnchor="middle" fontSize="10" fill="currentColor">
              {new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(rps)}
            </text>
          ))}
          {breakingPointRps !== null && breakingPointRps <= maxRps && (
            <line
              x1={x(breakingPointRps)}
              x2={x(breakingPointRps)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--destructive)"
              strokeDasharray="4 3"
            />
          )}
          <line
            x1={x(Math.min(traffic.totalRps, maxRps))}
            x2={x(Math.min(traffic.totalRps, maxRps))}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="var(--foreground)"
            strokeOpacity={0.5}
          />
          {ops.length > 1 &&
            ops.map((o, i) => (
              <path
                key={o.id}
                d={line(points.map((p) => p.operations[o.id] ?? 1))}
                fill="none"
                stroke={SERIES_COLOURS[i % SERIES_COLOURS.length]}
                strokeWidth={1.5}
                strokeDasharray="5 3"
              />
            ))}
          <path
            d={line(points.map((p) => p.processingSuccessRate))}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2.5}
          />
        </svg>
        <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-primary" aria-hidden /> All requests
          </span>
          {ops.length > 1 &&
            ops.map((o, i) => (
              <span key={o.id} className="flex items-center gap-1.5">
                <span
                  className="h-0.5 w-4"
                  style={{ background: SERIES_COLOURS[i % SERIES_COLOURS.length] }}
                  aria-hidden
                />
                {o.name}
              </span>
            ))}
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-px bg-foreground/50" aria-hidden /> Current traffic
          </span>
          {breakingPointRps !== null && (
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-px border-l border-dashed border-destructive" aria-hidden /> Breaking
              point
            </span>
          )}
        </figcaption>
      </figure>

      <div className="grid content-start gap-2 text-xs">
        <p>
          {breakingPointRps === null ? (
            "Nothing saturates: success stays at 100% across this range."
          ) : (
            <>
              Breaks at <span className="font-mono tabular-nums">{formatRate(breakingPointRps)}</span>{" "}
              requests/s.
            </>
          )}
        </p>
        {firstSaturated?.firstSaturated && (
          <p>
            From <span className="font-mono tabular-nums">{formatRate(firstSaturated.rps)}</span>/s,{" "}
            <NodeLink
              id={firstSaturated.firstSaturated.nodeId}
              suffix={RESOURCE_LABEL[firstSaturated.firstSaturated.resource] || undefined}
            />{" "}
            is the most saturated component.
          </p>
        )}
        <details>
          <summary className="cursor-pointer text-muted-foreground">Data table</summary>
          <table className="mt-1 w-full">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="pr-2 font-medium">Requests/s</th>
                <th className="text-right font-medium">Succeeded</th>
              </tr>
            </thead>
            <tbody>
              {points
                .filter((_, i) => i % 5 === 4)
                .map((p) => (
                  <tr key={p.rps} className="border-t">
                    <td className="pr-2 font-mono tabular-nums">{formatRate(p.rps)}</td>
                    <td className="text-right font-mono tabular-nums">
                      {formatPct(p.processingSuccessRate)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      </div>
    </div>
  );
}
