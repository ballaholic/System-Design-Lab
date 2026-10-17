import { flowUsages, type NodeId } from "@sdl/architecture";
import { useReactFlow } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Canvas } from "./canvas/Canvas";
import { Inspector } from "./inspector/Inspector";
import { Library } from "./library/Library";
import { OutlineView } from "./outline/OutlineView";
import type { Persistence } from "./persistence/saveStatus";
import { type PlaygroundUi, PlaygroundUiContext } from "./playgroundUi";
import { useEditor, useEditorStore } from "./store/editorContext";
import { type PlaygroundView, Toolbar } from "./toolbar/Toolbar";
import { useEditorShortcuts } from "./useEditorShortcuts";
import { IssuesPanel } from "./validation/IssuesPanel";
import { issueCounts } from "./validation/issueCounts";

const wide = () =>
  typeof window === "undefined" || window.matchMedia?.("(min-width: 1024px)").matches !== false;

export function PlaygroundEditor({ persistence }: { persistence: Persistence }) {
  const store = useEditorStore();
  const issues = useEditor((s) => s.issues);
  const { fitView } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PlaygroundView>("diagram");
  const [libraryOpen, setLibraryOpen] = useState(wide);
  const [inspectorOpen, setInspectorOpen] = useState(wide);
  const [panel, setPanel] = useState("inspect");
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const { errors, warnings } = issueCounts(issues);

  const deleteNow = useCallback(() => {
    const { nodeIds, edgeIds } = store.getState().selection;
    store.getState().deleteSelection();
    const parts = [
      nodeIds.length > 0 && `${nodeIds.length} component${nodeIds.length === 1 ? "" : "s"}`,
      edgeIds.length > 0 && `${edgeIds.length} connection${edgeIds.length === 1 ? "" : "s"}`,
    ].filter(Boolean);
    toast(`Deleted ${parts.join(" and ")}`, {
      action: { label: "Undo", onClick: () => store.getState().undo() },
    });
  }, [store]);

  const ui = useMemo<PlaygroundUi>(
    () => ({
      requestDelete: () => {
        const { doc, selection } = store.getState();
        if (selection.nodeIds.length + selection.edgeIds.length === 0) return;
        const affected = new Set(selection.edgeIds);
        for (const e of doc.edges) {
          if (selection.nodeIds.includes(e.source) || selection.nodeIds.includes(e.target))
            affected.add(e.id);
        }
        const usages = flowUsages(doc, affected).filter((u) => !selection.nodeIds.includes(u.nodeId));
        if (usages.length === 0) {
          deleteNow();
          return;
        }
        const name = (id: string) => doc.nodes.find((n) => n.id === id)?.label ?? id;
        const op = (id: string) => doc.operations.find((o) => o.id === id)?.name ?? id;
        setPendingDelete(usages.map((u) => `${op(u.operation)} on ${name(u.nodeId)}`));
      },
      duplicate: () => {
        const result = store.getState().duplicateSelection();
        if (!result.ok) toast.error(result.reason);
      },
      focusNode: (id: NodeId) => {
        store.getState().setSelection({ nodeIds: [id], edgeIds: [] });
        setView("diagram");
        setInspectorOpen(true);
        setPanel("inspect");
        // Wait a frame so the canvas is visible before moving the viewport.
        requestAnimationFrame(() => void fitView({ nodes: [{ id }], duration: 300, maxZoom: 1.2 }));
      },
      save: persistence.saveNow,
    }),
    [store, deleteNow, fitView, persistence.saveNow],
  );

  useEditorShortcuts(store, ui);

  return (
    <PlaygroundUiContext.Provider value={ui}>
      <div className="flex h-full min-h-0 flex-col">
        <Toolbar
          persistence={persistence}
          view={view}
          onViewChange={setView}
          libraryOpen={libraryOpen}
          inspectorOpen={inspectorOpen}
          onToggleLibrary={() => setLibraryOpen((v) => !v)}
          onToggleInspector={() => setInspectorOpen((v) => !v)}
        />
        {persistence.error && (
          <p role="alert" className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            {persistence.error}
          </p>
        )}
        <div className="relative flex min-h-0 flex-1">
          {libraryOpen && (
            <aside
              aria-label="Components"
              className="absolute inset-y-0 left-0 z-10 w-60 border-r bg-background lg:static lg:z-auto lg:w-56 lg:shrink-0"
            >
              <Library canvasElement={() => canvasRef.current} />
            </aside>
          )}
          <div ref={canvasRef} className={cn("relative min-w-0 flex-1", view !== "diagram" && "hidden")}>
            <Canvas />
          </div>
          {view === "outline" && (
            <div className="min-w-0 flex-1">
              <OutlineView onSelectNode={ui.focusNode} />
            </div>
          )}
          {inspectorOpen && (
            <aside
              aria-label="Inspector"
              className="absolute inset-y-0 right-0 z-10 flex w-80 flex-col border-l bg-background lg:static lg:z-auto lg:shrink-0"
            >
              <Tabs value={panel} onValueChange={setPanel} className="flex min-h-0 flex-1 flex-col gap-0">
                <TabsList className="mx-3 mt-2 grid w-auto grid-cols-2">
                  <TabsTrigger value="inspect">Inspect</TabsTrigger>
                  <TabsTrigger value="issues">
                    Issues
                    {errors + warnings > 0 && (
                      <span
                        className={cn(
                          "ml-1 rounded px-1 font-mono text-[10px]",
                          errors > 0 ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning",
                        )}
                      >
                        {errors + warnings}
                        <span className="sr-only">
                          {" "}
                          ({errors} errors, {warnings} warnings)
                        </span>
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="inspect" className="min-h-0 flex-1 overflow-y-auto">
                  <Inspector />
                </TabsContent>
                <TabsContent value="issues" className="min-h-0 flex-1 overflow-y-auto">
                  <IssuesPanel />
                </TabsContent>
              </Tabs>
            </aside>
          )}
        </div>
      </div>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete and update flows?</AlertDialogTitle>
            <AlertDialogDescription>
              Flows use the connections you're deleting. Their steps that use them will be removed from:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc pl-5 text-sm">
            {pendingDelete?.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">You can undo this.</p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPendingDelete(null);
                deleteNow();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {persistence.resolveConflict && (
        <AlertDialog open={persistence.status === "conflict"}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>This design was changed elsewhere</AlertDialogTitle>
              <AlertDialogDescription>
                Another tab or device saved a newer version while you were editing. Load that version (your
                unsaved changes here are discarded), or keep your version and overwrite it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => void persistence.resolveConflict?.("reload")}>
                Load newer version
              </AlertDialogCancel>
              <AlertDialogAction onClick={() => void persistence.resolveConflict?.("overwrite")}>
                Keep mine
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </PlaygroundUiContext.Provider>
  );
}
