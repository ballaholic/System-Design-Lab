import type { NodeId } from "@sdl/architecture";
import { createContext, useContext } from "react";

/** Page-level actions shared by the toolbar, inspector, outline and keyboard shortcuts. */
export interface PlaygroundUi {
  /** Deletes the selection, asking first when flows use an affected connection. */
  requestDelete(): void;
  duplicate(): void;
  /** Selects a component and centres the canvas on it. */
  focusNode(id: NodeId): void;
  /** Opens the inspector on the Issues tab. */
  showIssues(): void;
  save(): void;
}

export const PlaygroundUiContext = createContext<PlaygroundUi | null>(null);

export function usePlaygroundUi(): PlaygroundUi {
  const ui = useContext(PlaygroundUiContext);
  if (!ui) throw new Error("usePlaygroundUi must be used inside the playground");
  return ui;
}
