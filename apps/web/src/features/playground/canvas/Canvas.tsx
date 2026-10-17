import { checkConnection, isComponentType } from "@sdl/architecture";
import {
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type EdgeChange,
  type FinalConnectionState,
  MarkerType,
  MiniMap,
  type NodeChange,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTheme } from "@/app/themeContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NodeFailureMenuItems } from "../simulation/FailureControls";
import { useOverlayResult } from "../simulation/simulationContext";
import { useEditor, useEditorStore } from "../store/editorContext";
import { ComponentNode } from "./ComponentNode";
import { ConnectionEdge } from "./ConnectionEdge";
import { type ComponentFlowNode, type Measured, toFlowEdges, toFlowNodes } from "./toFlow";

export const COMPONENT_DRAG_MIME = "application/x-sdl-component";

const nodeTypes = { component: ComponentNode };
const edgeTypes = { connection: ConnectionEdge };
const defaultEdgeOptions = { markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } };
const NODE_CENTER = { x: 96, y: 28 };

/**
 * React Flow adapter. The editor store owns the document; nodes are mirrored into local state only so React
 * Flow can move them smoothly while dragging and remember their measured size. A drag commits one history
 * entry when it stops.
 */
export function Canvas() {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const issues = useEditor((s) => s.issues);
  const scenario = useEditor((s) => s.scenario);
  const overlay = useOverlayResult();
  const { resolvedTheme } = useTheme();
  const [menu, setMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const measured = useRef<Measured>(new Map());
  const sim = useMemo(() => (overlay ? { result: overlay, scenario } : null), [overlay, scenario]);
  const [nodes, setNodes] = useState<ComponentFlowNode[]>(() => toFlowNodes(doc, selection, issues));
  useEffect(() => {
    setNodes(toFlowNodes(doc, selection, issues, measured.current, sim));
  }, [doc, selection, issues, sim]);
  const edges = useMemo(
    () => toFlowEdges(doc, selection, issues, overlay),
    [doc, selection, issues, overlay],
  );

  const applySelection = useCallback(
    (changes: Array<NodeChange | EdgeChange>, kind: "nodeIds" | "edgeIds") => {
      const current = store.getState().selection;
      const ids = new Set(current[kind]);
      let changed = false;
      for (const change of changes) {
        if (change.type !== "select") continue;
        changed = true;
        if (change.selected) ids.add(change.id);
        else ids.delete(change.id);
      }
      if (changed) store.getState().setSelection({ ...current, [kind]: [...ids] });
    },
    [store],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<ComponentFlowNode>[]) => {
      for (const change of changes) {
        if (change.type === "dimensions" && change.dimensions)
          measured.current.set(change.id, change.dimensions);
      }
      // Deletion goes through the keyboard shortcut so flows using a connection can be confirmed first.
      setNodes((current) =>
        applyNodeChanges(
          changes.filter((c) => c.type !== "remove"),
          current,
        ),
      );
      applySelection(changes, "nodeIds");
    },
    [applySelection],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => applySelection(changes, "edgeIds"),
    [applySelection],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, __: unknown, dragged: ComponentFlowNode[]) => {
      store.getState().moveNodes(Object.fromEntries(dragged.map((n) => [n.id, n.position])));
    },
    [store],
  );

  const isValidConnection = useCallback(
    (c: Connection | { source: string; target: string }) =>
      checkConnection(store.getState().doc, c.source, c.target).ok,
    [store],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const result = store.getState().connect(c.source, c.target);
      if (!result.ok) toast.error("Can't connect", { description: result.reason });
    },
    [store],
  );

  // React Flow doesn't call onConnect for refused connections; explain the rule instead of failing silently.
  const onConnectEnd = useCallback(
    (_: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid !== false || !state.fromNode || !state.toNode) return;
      const check = checkConnection(store.getState().doc, state.fromNode.id, state.toNode.id);
      if (!check.ok) toast.error("Can't connect", { description: check.reason });
    },
    [store],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes(COMPONENT_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      const type = event.dataTransfer.getData(COMPONENT_DRAG_MIME);
      if (!isComponentType(type)) return;
      event.preventDefault();
      const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const result = store.getState().addComponent(type, { x: p.x - NODE_CENTER.x, y: p.y - NODE_CENTER.y });
      if (!result.ok) toast.error(result.reason);
    },
    [screenToFlowPosition, store],
  );

  // Right-click a component for failure injection.
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: ComponentFlowNode) => {
      event.preventDefault();
      store.getState().setSelection({ nodeIds: [node.id], edgeIds: [] });
      setMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
    },
    [store],
  );
  const menuNode = menu ? doc.nodes.find((n) => n.id === menu.nodeId) : undefined;

  return (
    <>
      <ReactFlow<ComponentFlowNode>
        aria-label="Architecture diagram"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeContextMenu={onNodeContextMenu}
        deleteKeyCode={null}
        multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        connectionRadius={28}
        colorMode={resolvedTheme}
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          ariaLabel="Diagram overview"
          className="max-sm:!hidden"
        />
      </ReactFlow>
      <DropdownMenu open={menuNode !== undefined} onOpenChange={(open) => !open && setMenu(null)}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed size-px"
            style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        {menuNode && (
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="truncate">{menuNode.label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Inject a failure (simulation only)
            </DropdownMenuLabel>
            <NodeFailureMenuItems node={menuNode} />
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    </>
  );
}
