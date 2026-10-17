import { CATALOG } from "@sdl/architecture";
import type { Resource, ValidSimulationResult } from "@sdl/simulation";
import { cn } from "@/lib/utils";
import { useEditor } from "../store/editorContext";
import { NodeLink } from "./NodeLink";
import { formatPct, formatRate, RESOURCE_LABEL, STATUS_UI } from "./simulationUi";

const RESOURCES: Resource[] = ["total", "read", "write"];

/** Every component's numbers and the engine's explanation (SIM-3, SIM-4). */
export function ComponentsTab({ result }: { result: ValidSimulationResult }) {
  const nodes = useEditor((s) => s.doc.nodes);
  return (
    <div className="overflow-x-auto p-3">
      <table className="w-full min-w-[40rem] text-xs">
        <caption className="sr-only">Simulation results per component</caption>
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 pr-3 font-medium">Component</th>
            <th className="py-1 pr-3 font-medium">Status</th>
            <th className="py-1 pr-3 text-right font-medium">Offered/s</th>
            <th className="py-1 pr-3 text-right font-medium">Rejected/s</th>
            <th className="py-1 pr-3 text-right font-medium">Utilization</th>
            <th className="py-1 font-medium">Why</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => {
            const r = result.nodes[node.id];
            if (!r) return null;
            const ui = STATUS_UI[r.status];
            const Icon = ui.icon;
            const resources = RESOURCES.filter((res) => r.resources[res]);
            const offered = Object.values(r.byOperation).reduce((a, o) => a + o.offered, 0);
            return (
              <tr key={node.id} className="border-t align-top">
                <td className="max-w-40 py-1.5 pr-3">
                  <NodeLink id={node.id} />
                  <span className="block text-muted-foreground">{CATALOG[node.type].name}</span>
                </td>
                <td className="py-1.5 pr-3">
                  <span className={cn("flex items-center gap-1 whitespace-nowrap font-medium", ui.text)}>
                    <Icon className="size-3.5" aria-hidden />
                    {ui.label}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatRate(offered)}</td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                  {resources.length === 0
                    ? "–"
                    : formatRate(resources.reduce((a, res) => a + r.resources[res]!.rejected, 0))}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono tabular-nums">
                  {resources.length === 0
                    ? "–"
                    : resources.map((res) => (
                        <span key={res} className="block">
                          {RESOURCE_LABEL[res] && (
                            <span className="font-sans text-muted-foreground">{RESOURCE_LABEL[res]} </span>
                          )}
                          {r.resources[res]!.capacity === 0
                            ? "down"
                            : formatPct(r.resources[res]!.utilization)}
                        </span>
                      ))}
                </td>
                <td className="py-1.5 text-muted-foreground">
                  {r.explanation.length === 0 ? (
                    "Receives no traffic."
                  ) : (
                    <ul className="grid gap-0.5">
                      {r.explanation.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
