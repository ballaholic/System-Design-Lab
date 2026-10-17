import type { SimulationResult, ValidSimulationResult } from "@sdl/simulation";
import { createContext, useContext } from "react";

export type SimulationTab = "summary" | "components" | "events" | "sweep";

export interface SimulationView {
  /** The simulation panel is open; overlays show only while it is. */
  open: boolean;
  setOpen(open: boolean): void;
  /** Recompute automatically as the design changes (SIM-6). Otherwise results change only on Run. */
  live: boolean;
  setLive(live: boolean): void;
  /** The result on show: the live result, or the last run. Null while closed or before the first run. */
  result: SimulationResult | null;
  /** The result on show was computed from different inputs than the current ones. */
  stale: boolean;
  run(): void;
  tab: SimulationTab;
  setTab(tab: SimulationTab): void;
}

const closed: SimulationView = {
  open: false,
  setOpen: () => {},
  live: true,
  setLive: () => {},
  result: null,
  stale: false,
  run: () => {},
  tab: "summary",
  setTab: () => {},
};

export const SimulationContext = createContext<SimulationView>(closed);

export function useSimulation(): SimulationView {
  return useContext(SimulationContext);
}

/** The valid result to draw on the canvas and inspector, if the panel is open and the design simulates. */
export function useOverlayResult(): ValidSimulationResult | null {
  const { open, result } = useSimulation();
  return open && result?.status === "ok" ? result : null;
}
