import type { ArchitectureDocument } from "@sdl/architecture";
import { ReactFlowProvider } from "@xyflow/react";
import { type ReactNode, useState } from "react";
import { EditorStoreContext } from "./store/editorContext";
import { createEditorStore, type EditorStore } from "./store/editorStore";

/** One editing session: an editor store for the document (with its undo history) and the React Flow context. */
export function EditorSession({
  doc,
  children,
}: {
  doc: ArchitectureDocument;
  children: (store: EditorStore) => ReactNode;
}) {
  const [store] = useState(() => createEditorStore(doc));
  return (
    <EditorStoreContext.Provider value={store}>
      <ReactFlowProvider>{children(store)}</ReactFlowProvider>
    </EditorStoreContext.Provider>
  );
}

/** The editor fills the viewport below the app header. */
export function FullHeight({ children }: { children: ReactNode }) {
  return <div className="flex h-[calc(100svh-3.5rem)] flex-col">{children}</div>;
}
