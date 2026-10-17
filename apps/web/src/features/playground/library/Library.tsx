import { CATALOG, CATEGORIES, COMPONENT_TYPES, type ComponentType } from "@sdl/architecture";
import { useReactFlow } from "@xyflow/react";
import { Search } from "lucide-react";
import { type DragEvent, useId, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { COMPONENT_DRAG_MIME } from "../canvas/Canvas";
import { ICONS } from "../catalogUi";
import { useEditorStore } from "../store/editorContext";

/** Component palette (PG-1): grouped, searchable, drag to the canvas or press Enter to add at the centre. */
export function Library({ canvasElement }: { canvasElement: () => HTMLElement | null }) {
  const store = useEditorStore();
  const { screenToFlowPosition } = useReactFlow();
  const [query, setQuery] = useState("");
  const searchId = useId();
  const hintId = useId();

  const q = query.trim().toLowerCase();
  const matches = COMPONENT_TYPES.filter((type) => {
    const def = CATALOG[type];
    return (
      !q ||
      def.name.toLowerCase().includes(q) ||
      def.description.toLowerCase().includes(q) ||
      type.includes(q)
    );
  });

  const addAtCenter = (type: ComponentType) => {
    const rect = canvasElement()?.getBoundingClientRect();
    const center = rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 };
    // Nudge repeated additions so they don't stack exactly on top of each other.
    const offset = (store.getState().doc.nodes.length % 5) * 24;
    const result = store
      .getState()
      .addComponent(type, { x: center.x - 96 + offset, y: center.y - 28 + offset });
    if (result.ok) toast.success(`Added ${CATALOG[type].name}`, { duration: 1500 });
    else toast.error(result.reason);
  };

  const onDragStart = (event: DragEvent, type: ComponentType) => {
    event.dataTransfer.setData(COMPONENT_DRAG_MIME, type);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <label htmlFor={searchId} className="sr-only">
          Search components
        </label>
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={searchId}
            type="search"
            placeholder="Search components"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {CATEGORIES.map((category) => {
          const items = matches.filter((type) => CATALOG[type].category === category.id);
          if (items.length === 0) return null;
          return (
            <section key={category.id} aria-labelledby={`lib-${category.id}`} className="mb-3">
              <h3
                id={`lib-${category.id}`}
                className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                {category.name}
              </h3>
              <ul className="grid gap-0.5">
                {items.map((type) => {
                  const def = CATALOG[type];
                  const Icon = ICONS[def.icon];
                  return (
                    <li key={type}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => onDragStart(e, type)}
                        onClick={() => addAtCenter(type)}
                        className="flex w-full cursor-grab items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                        title={def.description}
                        aria-describedby={hintId}
                      >
                        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted">
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <span className="truncate">{def.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {matches.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted-foreground">No components match "{query}".</p>
        )}
      </div>
      <p id={hintId} className="border-t p-3 text-xs text-muted-foreground">
        Drag onto the canvas, or select and press Enter to add at the centre.
      </p>
    </div>
  );
}
