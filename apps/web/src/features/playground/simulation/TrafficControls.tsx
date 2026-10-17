import { LIMITS } from "@sdl/architecture";
import { RotateCcw } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSyncedState } from "@/lib/useSyncedState";
import { useEditor, useEditorStore } from "../store/editorContext";
import { formatPct, mixForReadShare, readShare, trafficOf } from "./simulationUi";

const RPS_PRESETS = [100, 1_000, 10_000, 100_000];

/**
 * Total RPS and the read share (SIM-1). The read share is derived from the operation shares; moving it saves
 * a mix override with the traffic, which keeps the relative shares of the reads and of the writes.
 */
export function TrafficControls() {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const traffic = trafficOf(doc);
  const rpsId = useId();
  const readId = useId();
  const [rpsText, setRpsText] = useSyncedState(String(traffic.totalRps));
  const reads = readShare(doc.operations, traffic);
  const hasBothKinds =
    doc.operations.some((o) => o.share > 0 && o.kind === "read") &&
    doc.operations.some((o) => o.share > 0 && o.kind === "write");

  const setRps = (totalRps: number) => store.getState().setTraffic({ ...traffic, totalRps });
  const setReads = (ratio: number) => {
    const mix = mixForReadShare(doc.operations, ratio);
    const { mix: _old, ...rest } = traffic;
    store.getState().setTraffic(mix ? { ...rest, mix } : rest);
  };

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="grid gap-1">
        <Label htmlFor={rpsId} className="text-xs">
          Total traffic (requests/s)
        </Label>
        <div className="flex items-center gap-1">
          <Input
            id={rpsId}
            type="number"
            inputMode="numeric"
            min={1}
            max={LIMITS.maxTotalRps}
            value={rpsText}
            className="h-8 w-28 font-mono text-sm tabular-nums"
            aria-describedby={`${rpsId}-hint`}
            onChange={(e) => {
              setRpsText(e.target.value);
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0 && n <= LIMITS.maxTotalRps) setRps(n);
            }}
            onBlur={() => setRpsText(String(traffic.totalRps))}
          />
          <div className="hidden items-center sm:flex" role="group" aria-label="Traffic presets">
            {RPS_PRESETS.map((n) => (
              <Button
                key={n}
                type="button"
                size="sm"
                variant={traffic.totalRps === n ? "secondary" : "ghost"}
                className="h-7 px-1.5 font-mono text-xs"
                onClick={() => setRps(n)}
              >
                {new Intl.NumberFormat("en", { notation: "compact" }).format(n)}
              </Button>
            ))}
          </div>
        </div>
        <span id={`${rpsId}-hint`} className="sr-only">
          Between 1 and {LIMITS.maxTotalRps.toLocaleString("en")} requests per second.
        </span>
      </div>

      <div className="grid gap-1">
        <Label htmlFor={readId} className="text-xs">
          Reads {reads === null ? "" : formatPct(reads)}
          {reads !== null && <span className="text-muted-foreground"> · writes {formatPct(1 - reads)}</span>}
        </Label>
        <div className="flex items-center gap-1">
          <input
            id={readId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round((reads ?? 0) * 100)}
            disabled={!hasBothKinds}
            onChange={(e) => setReads(Number(e.target.value) / 100)}
            aria-valuetext={reads === null ? "No traffic" : `${formatPct(reads)} reads`}
            className="h-8 w-36 accent-primary disabled:opacity-50"
            title={hasBothKinds ? undefined : "Needs at least one read and one write operation with traffic"}
          />
          {traffic.mix && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Reset to the operation shares"
              title="Reset to the operation shares"
              onClick={() => {
                const { mix: _mix, ...rest } = traffic;
                store.getState().setTraffic(rest);
              }}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
