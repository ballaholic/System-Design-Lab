import type { NodeResult, Resource } from "@sdl/simulation";
import { cn } from "@/lib/utils";
import { formatPct, formatRate, RESOURCE_LABEL, STATUS_UI } from "./simulationUi";

const RESOURCES: Resource[] = ["total", "read", "write"];

/** One component's simulated status, load and explanation, for the inspector. */
export function NodeSimulationSummary({ result }: { result: NodeResult }) {
  const ui = STATUS_UI[result.status];
  const Icon = ui.icon;
  const resources = RESOURCES.filter((r) => result.resources[r]);
  return (
    <div className="grid gap-2 text-sm">
      <div>
        <p className={cn("flex items-center gap-1.5 font-medium", ui.text)}>
          <Icon className="size-4" aria-hidden />
          {ui.label}
        </p>
        <p className="text-xs text-muted-foreground">{ui.description}</p>
      </div>
      {resources.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {resources.map((r) => {
            const res = result.resources[r]!;
            return (
              <div key={r} className="contents">
                <dt className="text-muted-foreground">
                  {RESOURCE_LABEL[r] ? `Utilization (${RESOURCE_LABEL[r]})` : "Utilization"}
                </dt>
                <dd className="font-mono tabular-nums">
                  {res.capacity === 0 ? (
                    <span className="text-muted-foreground">
                      no capacity ({formatRate(res.offered)}/s offered)
                    </span>
                  ) : (
                    <>
                      {formatPct(res.utilization)}{" "}
                      <span className="text-muted-foreground">
                        ({formatRate(res.offered)} of {formatRate(res.capacity)}/s)
                      </span>
                    </>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {result.explanation.length > 0 && (
        <ul className="grid list-disc gap-0.5 pl-4 text-xs text-muted-foreground">
          {result.explanation.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
