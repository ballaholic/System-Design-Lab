import { type ArchitectureDocument, createEmptyDocument } from "@sdl/architecture";
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { type PlaygroundUi, PlaygroundUiContext } from "../playgroundUi";
import { EditorStoreContext } from "../store/editorContext";
import { createEditorStore } from "../store/editorStore";

/** Renders playground UI with a real editor store and spy page actions. */
export function renderEditor(ui: ReactElement, doc: ArchitectureDocument = createEmptyDocument()) {
  const store = createEditorStore(doc);
  const actions: PlaygroundUi = {
    requestDelete: vi.fn(),
    duplicate: vi.fn(),
    focusNode: vi.fn(),
    showIssues: vi.fn(),
    save: vi.fn(),
  };
  const result = render(
    <EditorStoreContext.Provider value={store}>
      <PlaygroundUiContext.Provider value={actions}>
        <ReactFlowProvider>
          <TooltipProvider>{ui}</TooltipProvider>
        </ReactFlowProvider>
      </PlaygroundUiContext.Provider>
    </EditorStoreContext.Provider>,
  );
  return { ...result, store, actions, s: () => store.getState() };
}
