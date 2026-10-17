import { simulate, type SimulationResult, simulationInputHash } from "@sdl/simulation";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useEditor, useEditorStore } from "../store/editorContext";
import { SimulationContext, type SimulationTab, type SimulationView } from "./simulationContext";
import { trafficOf } from "./simulationUi";

/** Live mode waits this long after the last edit before recomputing (typing in a field). */
const LIVE_DEBOUNCE_MS = 200;
/** Success rates at or above this count as "all requests succeed". */
const ALL_SUCCEED = 0.9995;

/**
 * Runs the engine in the browser (ARCHITECTURE §6.11): no network, so guests get the full simulator.
 * Inputs are the current document, its saved traffic and the session's injected failures.
 */
export function SimulationProvider({ children }: { children: ReactNode }) {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const scenario = useEditor((s) => s.scenario);
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState(true);
  const [tab, setTab] = useState<SimulationTab>("summary");
  const [lastRun, setLastRun] = useState<SimulationResult | null>(null);

  const inputs = useMemo(() => ({ doc, scenario }), [doc, scenario]);
  const debounced = useDebouncedValue(inputs, LIVE_DEBOUNCE_MS);
  const liveResult = useMemo(
    () => (open && live ? simulate(debounced.doc, trafficOf(debounced.doc), debounced.scenario) : null),
    [open, live, debounced],
  );

  const run = useCallback(() => {
    const { doc: current, scenario: failures } = store.getState();
    setLastRun(simulate(current, trafficOf(current), failures));
  }, [store]);

  const result = live ? liveResult : lastRun;

  // Fixing a design (some requests failing → all succeed) is worth celebrating. Tracked during render
  // ("adjust state during render"), so each fix counts once.
  const successRate =
    result?.status === "ok" && result.summary.offered > 0 ? result.summary.processingSuccessRate : null;
  const [previousRate, setPreviousRate] = useState(successRate);
  const [celebration, setCelebration] = useState(0);
  if (successRate !== previousRate) {
    setPreviousRate(successRate);
    if (
      previousRate !== null &&
      previousRate < ALL_SUCCEED &&
      successRate !== null &&
      successRate >= ALL_SUCCEED
    ) {
      setCelebration((c) => c + 1);
    }
  }
  const stale = useMemo(
    () =>
      result !== null &&
      (live ? debounced !== inputs : result.inputHash !== simulationInputHash(doc, trafficOf(doc), scenario)),
    [result, live, debounced, inputs, doc, scenario],
  );

  const value = useMemo<SimulationView>(
    () => ({
      open,
      setOpen: (next) => {
        // A celebration belongs to the moment it happened; reopening the panel shouldn't replay it.
        if (!next) setCelebration(0);
        setOpen(next);
      },
      live,
      setLive: (next) => {
        // Switching live off keeps the current result on show until the next run.
        if (!next && liveResult) setLastRun(liveResult);
        setLive(next);
      },
      result,
      stale,
      run,
      tab,
      setTab,
      celebration,
    }),
    [open, live, liveResult, result, stale, run, tab, celebration],
  );

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}
