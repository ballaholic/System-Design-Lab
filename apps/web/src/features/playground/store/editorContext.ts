import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { EditorState, EditorStore } from "./editorStore";

export const EditorStoreContext = createContext<EditorStore | null>(null);

export function useEditorStore(): EditorStore {
  const store = useContext(EditorStoreContext);
  if (!store) throw new Error("useEditorStore must be used inside <EditorStoreContext>");
  return store;
}

/** Subscribes to a slice of the editor state. Return primitives or stable references, or wrap with useShallow. */
export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorStore(), selector);
}
