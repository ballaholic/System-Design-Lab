import { ENGINE_VERSION } from "@sdl/simulation";
import { CircleAlert, ExternalLink, Play, X } from "lucide-react";
import { useId } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePlaygroundUi } from "../playgroundUi";
import { Celebration } from "./Celebration";
import { ComponentsTab } from "./ComponentsTab";
import { EventsTab } from "./EventsTab";
import { FailureChips } from "./FailureControls";
import { type SimulationTab, useSimulation } from "./simulationContext";
import { SummaryTab } from "./SummaryTab";
import { SweepTab } from "./SweepTab";
import { TrafficControls } from "./TrafficControls";

/** Bottom panel: traffic, run controls and results (SIM-1 to SIM-8). Every number comes from the engine. */
export function SimulationPanel() {
  const sim = useSimulation();
  const ui = usePlaygroundUi();
  const liveId = useId();
  const { result } = sim;
  const blocking = result?.status === "invalid" ? result.issues.filter((i) => i.severity === "error") : [];
  const allSucceed = result?.status === "ok" && result.summary.processingSuccessRate >= 0.9995;
  const eventCount = result?.status === "ok" ? result.events.filter((e) => e.kind !== "idle").length : 0;

  return (
    <section
      aria-label="Simulation"
      className="flex h-[45%] min-h-56 shrink-0 flex-col border-t bg-background lg:h-80"
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b px-3 py-2">
        <TrafficControls />
        <div className="flex items-center gap-3 pb-0.5">
          <div className="flex items-center gap-1.5">
            <Switch id={liveId} checked={sim.live} onCheckedChange={sim.setLive} />
            <Label htmlFor={liveId} className="text-xs font-normal">
              Live
            </Label>
          </div>
          {!sim.live && (
            <Button size="sm" className="h-8 gap-1.5" onClick={sim.run}>
              <Play className="size-3.5" /> Run
            </Button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 pb-1 text-xs text-muted-foreground">
          <span>
            Engine v{ENGINE_VERSION} ·{" "}
            <Link
              to="/docs/simulator"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
            >
              How the simulator works
              <ExternalLink className="size-3" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </Link>
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Close simulation"
            onClick={() => sim.setOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 pt-2 empty:hidden">
        <FailureChips />
        {sim.celebration > 0 && allSucceed && <Celebration key={sim.celebration} />}
        {sim.stale && result && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {sim.live ? "Updating…" : "The design changed since this run. Run again to update."}
          </span>
        )}
      </div>

      {result === null ? (
        <p className="p-4 text-sm text-muted-foreground">Press Run to simulate the current design.</p>
      ) : result.status === "invalid" ? (
        <div className="flex items-start gap-2 p-4 text-sm" role="status">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="grid gap-2">
            <p>
              {blocking.length === 1 ? "1 problem blocks" : `${blocking.length} problems block`} the
              simulation: {blocking[0]?.message}
            </p>
            <Button size="sm" variant="outline" className="w-fit" onClick={ui.showIssues}>
              Show issues
            </Button>
          </div>
        </div>
      ) : (
        <Tabs
          value={sim.tab}
          onValueChange={(tab) => sim.setTab(tab as SimulationTab)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList className="mx-3 mt-2 w-fit">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="components">Components</TabsTrigger>
            <TabsTrigger value="events">
              Events
              {eventCount > 0 && (
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">{eventCount}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="sweep">Sweep</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="min-h-0 flex-1 overflow-y-auto">
            <SummaryTab result={result} />
          </TabsContent>
          <TabsContent value="components" className="min-h-0 flex-1 overflow-y-auto">
            <ComponentsTab result={result} />
          </TabsContent>
          <TabsContent value="events" className="min-h-0 flex-1 overflow-y-auto">
            <EventsTab result={result} />
          </TabsContent>
          <TabsContent value="sweep" className="min-h-0 flex-1 overflow-y-auto">
            {sim.tab === "sweep" && <SweepTab />}
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}
