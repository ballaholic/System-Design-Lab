import type { SimEventKind, ValidSimulationResult } from "@sdl/simulation";
import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleOff,
  Flame,
  type LucideIcon,
  Route,
  ShieldBan,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlaygroundUi } from "../playgroundUi";

const EVENT_UI: Record<SimEventKind, { label: string; icon: LucideIcon; className: string }> = {
  down: { label: "Down", icon: CircleOff, className: "text-destructive" },
  saturated: { label: "Saturated", icon: Flame, className: "text-destructive" },
  "rate-limited": { label: "Rate-limited", icon: ShieldBan, className: "text-warning" },
  unroutable: { label: "Unroutable", icon: Route, className: "text-destructive" },
  "backlog-growing": { label: "Backlog growing", icon: TrendingUp, className: "text-warning" },
  unmodeled: { label: "Not modeled", icon: CircleHelp, className: "text-info" },
  idle: { label: "Idle", icon: CircleDashed, className: "text-muted-foreground" },
};

const ORDER: SimEventKind[] = [
  "down",
  "unroutable",
  "saturated",
  "rate-limited",
  "backlog-growing",
  "unmodeled",
  "idle",
];

/** Engine events, including what the design implies but the simulator doesn't model (SIM-7, FAIL-3). */
export function EventsTab({ result }: { result: ValidSimulationResult }) {
  const ui = usePlaygroundUi();
  const events = [...result.events].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  if (events.length === 0) {
    return (
      <p className="flex items-center gap-2 p-3 text-sm">
        <CircleCheck className="size-4 text-success" aria-hidden />
        Nothing to report: no component is saturated, down or falling behind.
      </p>
    );
  }
  return (
    <ul className="grid gap-1.5 p-3 text-xs">
      {events.map((e, i) => {
        const kind = EVENT_UI[e.kind];
        const Icon = kind.icon;
        const content = (
          <>
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", kind.className)} aria-hidden />
            <span className="min-w-0">
              <span className={cn("font-medium", kind.className)}>{kind.label}: </span>
              {e.message}
            </span>
          </>
        );
        return (
          <li key={`${e.kind}-${i}`}>
            {e.nodeIds.length > 0 ? (
              <button
                type="button"
                onClick={() => ui.focusNode(e.nodeIds[0]!)}
                className="flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {content}
              </button>
            ) : (
              <div className="flex items-start gap-2 rounded-md border px-2.5 py-2">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
