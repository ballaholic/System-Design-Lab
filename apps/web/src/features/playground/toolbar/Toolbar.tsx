import { useReactFlow } from "@xyflow/react";
import {
  List,
  Maximize,
  Network,
  PanelLeft,
  PanelRight,
  Redo2,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSyncedState } from "@/lib/useSyncedState";
import { cn } from "@/lib/utils";
import type { Persistence } from "../persistence/saveStatus";
import { useEditor, useEditorStore } from "../store/editorContext";
import { SaveIndicator } from "./SaveIndicator";

export type PlaygroundView = "diagram" | "outline";

interface ToolbarProps {
  persistence: Persistence;
  view: PlaygroundView;
  onViewChange(view: PlaygroundView): void;
  libraryOpen: boolean;
  inspectorOpen: boolean;
  onToggleLibrary(): void;
  onToggleInspector(): void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

function ToolButton({
  label,
  shortcut,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick(): void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className={cn("size-8", pressed && "bg-accent")}
          aria-label={shortcut ? `${label} (${shortcut})` : label}
          aria-pressed={pressed}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <span className="ml-1.5 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

export function Toolbar({
  persistence,
  view,
  onViewChange,
  libraryOpen,
  inspectorOpen,
  onToggleLibrary,
  onToggleInspector,
}: ToolbarProps) {
  const store = useEditorStore();
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const [title, setTitle] = useSyncedState(persistence.title);

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b bg-background px-2">
      <ToolButton
        label={libraryOpen ? "Hide components" : "Show components"}
        onClick={onToggleLibrary}
        pressed={libraryOpen}
      >
        <PanelLeft className="size-4" />
      </ToolButton>
      <label htmlFor="design-title" className="sr-only">
        Design title
      </label>
      <Input
        id="design-title"
        value={title}
        maxLength={100}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          persistence.rename(title);
          setTitle(persistence.title === title.trim() || !title.trim() ? persistence.title : title.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setTitle(persistence.title);
            e.currentTarget.blur();
          }
        }}
        className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-2 text-sm font-medium shadow-none hover:border-input focus-visible:border-input sm:w-56 sm:flex-none"
      />
      <SaveIndicator persistence={persistence} />

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <ToolButton
          label="Undo"
          shortcut={`${mod}Z`}
          onClick={() => store.getState().undo()}
          disabled={!canUndo}
        >
          <Undo2 className="size-4" />
        </ToolButton>
        <ToolButton
          label="Redo"
          shortcut={isMac ? "⇧⌘Z" : "Ctrl+Y"}
          onClick={() => store.getState().redo()}
          disabled={!canRedo}
        >
          <Redo2 className="size-4" />
        </ToolButton>
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <div className="hidden items-center gap-0.5 sm:flex">
          <ToolButton
            label="Zoom out"
            onClick={() => void zoomOut({ duration: 150 })}
            disabled={view !== "diagram"}
          >
            <ZoomOut className="size-4" />
          </ToolButton>
          <ToolButton
            label="Zoom in"
            onClick={() => void zoomIn({ duration: 150 })}
            disabled={view !== "diagram"}
          >
            <ZoomIn className="size-4" />
          </ToolButton>
          <ToolButton
            label="Fit to screen"
            onClick={() => void fitView({ duration: 200, maxZoom: 1, padding: 0.2 })}
            disabled={view !== "diagram"}
          >
            <Maximize className="size-4" />
          </ToolButton>
        </div>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Diagram view" onClick={() => onViewChange("diagram")} pressed={view === "diagram"}>
          <Network className="size-4" />
        </ToolButton>
        <ToolButton
          label="Outline view (text)"
          onClick={() => onViewChange("outline")}
          pressed={view === "outline"}
        >
          <List className="size-4" />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {persistence.target === "account" ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={persistence.saveNow}
            aria-label={`Save (${mod}S)`}
          >
            <Save className="size-3.5" />
            <span className="hidden md:inline">Save</span>
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-8" asChild>
            <Link to="/login?next=/designs">
              <span className="hidden md:inline">Sign in to keep it</span>
              <span className="md:hidden">Sign in</span>
            </Link>
          </Button>
        )}
        <ToolButton
          label={inspectorOpen ? "Hide inspector" : "Show inspector"}
          onClick={onToggleInspector}
          pressed={inspectorOpen}
        >
          <PanelRight className="size-4" />
        </ToolButton>
      </div>
    </div>
  );
}
