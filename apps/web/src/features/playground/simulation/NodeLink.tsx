import type { NodeId } from "@sdl/architecture";
import { usePlaygroundUi } from "../playgroundUi";
import { useEditor } from "../store/editorContext";

/** A component's name that selects it and centres the canvas on it. */
export function NodeLink({ id, suffix }: { id: NodeId; suffix?: string }) {
  const ui = usePlaygroundUi();
  const label = useEditor((s) => s.doc.nodes.find((n) => n.id === id)?.label ?? id);
  return (
    <button
      type="button"
      className="max-w-full truncate text-left font-medium underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => ui.focusNode(id)}
    >
      {label}
      {suffix && <span className="font-normal text-muted-foreground"> {suffix}</span>}
    </button>
  );
}
