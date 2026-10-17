import { useEffect } from "react";
import type { PlaygroundUi } from "./playgroundUi";
import type { EditorStore } from "./store/editorStore";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.getAttribute("role") === "combobox"
  );
}

/** Keyboard shortcuts (PG-5): Del, Ctrl+D, Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y, Ctrl+S, Esc. */
export function useEditorShortcuts(store: EditorStore, ui: PlaygroundUi) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      // Save works everywhere, including while typing in a field.
      if (mod && key === "s") {
        event.preventDefault();
        ui.save();
        return;
      }
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      // Leave keys alone while a dialog or menu is open.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;

      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) store.getState().redo();
        else store.getState().undo();
      } else if (mod && key === "y") {
        event.preventDefault();
        store.getState().redo();
      } else if (mod && key === "d") {
        event.preventDefault();
        ui.duplicate();
      } else if (!mod && (event.key === "Delete" || event.key === "Backspace")) {
        const { nodeIds, edgeIds } = store.getState().selection;
        if (nodeIds.length + edgeIds.length === 0) return;
        event.preventDefault();
        ui.requestDelete();
      } else if (event.key === "Escape") {
        store.getState().setSelection({ nodeIds: [], edgeIds: [] });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, ui]);
}
