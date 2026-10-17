import {
  addEdge,
  addNode,
  type ArchitectureDocument,
  checkConnection,
  type ComponentType,
  createNode,
  duplicateNodes,
  type EdgeId,
  type FlowStep,
  LIMITS,
  type NodeId,
  type Operation,
  type OperationId,
  operationIdFromName,
  type Position,
  removeEdges,
  removeNodes,
  removeOperation,
  setFlow,
  updateNode,
  validateArchitecture,
  type TrafficProfile,
  type ValidationIssue,
} from "@sdl/architecture";
import { type Failure, type FailureScenario, normalizeScenario } from "@sdl/simulation";
import { createStore } from "zustand/vanilla";

export const HISTORY_LIMIT = 100;
/** Edits with the same coalesce key within this window merge into one undo step (typing in a field). */
export const COALESCE_MS = 1000;

export interface Selection {
  nodeIds: NodeId[];
  edgeIds: EdgeId[];
}

export const EMPTY_SELECTION: Selection = { nodeIds: [], edgeIds: [] };
export const NO_FAILURES: FailureScenario = { failures: [] };

export type CommitResult<T = void> = { ok: true; value: T } | { ok: false; reason: string };

export interface EditorState {
  doc: ArchitectureDocument;
  /** Older documents, most recent last (ADR-014: snapshot history). */
  past: ArchitectureDocument[];
  future: ArchitectureDocument[];
  selection: Selection;
  issues: ValidationIssue[];
  /** Increments on every document change, including undo and redo. Persistence compares it to what was saved. */
  revision: number;
  lastCommit: { key: string; at: number } | null;
  /** Injected failures for simulation. Session only: not saved and not part of undo history. */
  scenario: FailureScenario;
  /** The connection made most recently in this session, so the canvas can acknowledge it. Not history. */
  lastConnection: { edgeId: EdgeId; source: NodeId; target: NodeId; at: number } | null;

  /** Replaces the document and clears history (loading a design). */
  load(doc: ArchitectureDocument): void;
  /** Applies a pure update as one history entry. */
  commit(
    update: (doc: ArchitectureDocument) => ArchitectureDocument,
    options?: { coalesceKey?: string },
  ): void;
  undo(): void;
  redo(): void;
  setSelection(selection: Selection): void;

  addComponent(type: ComponentType, position: Position): CommitResult<NodeId>;
  connect(source: NodeId, target: NodeId): CommitResult<EdgeId>;
  moveNodes(positions: Record<NodeId, Position>): void;
  renameNode(id: NodeId, label: string): void;
  setNodeConfig(id: NodeId, key: string, value: unknown): void;
  setNodeFlow(
    id: NodeId,
    operation: OperationId,
    steps: FlowStep[] | null,
    options?: { coalesceKey?: string },
  ): void;
  setEdgeLabel(id: EdgeId, label: string): void;
  deleteSelection(): void;
  deleteEdges(ids: EdgeId[]): void;
  duplicateSelection(): CommitResult<NodeId[]>;
  addOperation(): OperationId | null;
  updateOperation(id: OperationId, patch: Partial<Omit<Operation, "id">>): void;
  deleteOperation(id: OperationId): void;
  setNotes(notes: string): void;
  /** Saves the simulation traffic in the document (last-used inputs). */
  setTraffic(traffic: TrafficProfile): void;
  setFailures(failures: Failure[]): void;
}

export type EditorStore = ReturnType<typeof createEditorStore>;

export function createEditorStore(initial: ArchitectureDocument, now: () => number = Date.now) {
  return createStore<EditorState>()((set, get) => {
    const commit: EditorState["commit"] = (update, options) => {
      const state = get();
      const next = update(state.doc);
      if (next === state.doc) return;
      const at = now();
      const key = options?.coalesceKey;
      const coalesce =
        key !== undefined && state.lastCommit?.key === key && at - state.lastCommit.at < COALESCE_MS;
      set({
        doc: next,
        past: coalesce ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: [],
        issues: validateArchitecture(next),
        revision: state.revision + 1,
        lastCommit: key === undefined ? null : { key, at },
        selection: pruneSelection(state.selection, next),
        scenario: pruneScenario(state.scenario, next),
      });
    };

    const travel = (from: "past" | "future") => {
      const state = get();
      const stack = state[from];
      const target = stack.at(-1);
      if (!target) return;
      const to = from === "past" ? "future" : "past";
      set({
        doc: target,
        [from]: stack.slice(0, -1),
        [to]: [...state[to], state.doc],
        issues: validateArchitecture(target),
        revision: state.revision + 1,
        lastCommit: null,
        selection: pruneSelection(state.selection, target),
        scenario: pruneScenario(state.scenario, target),
      });
    };

    return {
      doc: initial,
      past: [],
      future: [],
      selection: EMPTY_SELECTION,
      issues: validateArchitecture(initial),
      revision: 0,
      lastCommit: null,
      scenario: NO_FAILURES,
      lastConnection: null,

      load: (doc) =>
        set({
          doc,
          past: [],
          future: [],
          selection: EMPTY_SELECTION,
          issues: validateArchitecture(doc),
          revision: 0,
          lastCommit: null,
          scenario: NO_FAILURES,
          lastConnection: null,
        }),
      commit,
      undo: () => travel("past"),
      redo: () => travel("future"),
      setSelection: (selection) => {
        const current = get().selection;
        if (sameIds(current.nodeIds, selection.nodeIds) && sameIds(current.edgeIds, selection.edgeIds))
          return;
        set({ selection });
      },

      addComponent: (type, position) => {
        const { doc } = get();
        if (doc.nodes.length >= LIMITS.nodes) {
          return { ok: false, reason: `A design can have at most ${LIMITS.nodes} components.` };
        }
        const node = createNode(doc, type);
        commit((d) => addNode(d, node, position));
        set({ selection: { nodeIds: [node.id], edgeIds: [] } });
        return { ok: true, value: node.id };
      },

      connect: (source, target) => {
        const { doc } = get();
        const check = checkConnection(doc, source, target);
        if (!check.ok) return check;
        if (doc.edges.length >= LIMITS.edges) {
          return { ok: false, reason: `A design can have at most ${LIMITS.edges} connections.` };
        }
        const { doc: next, edge } = addEdge(doc, source, target);
        commit(() => next);
        set({
          selection: { nodeIds: [], edgeIds: [edge.id] },
          lastConnection: { edgeId: edge.id, source, target, at: now() },
        });
        return { ok: true, value: edge.id };
      },

      moveNodes: (positions) =>
        commit((d) => {
          const changed = Object.entries(positions).filter(([id, p]) => {
            const current = d.layout[id];
            return d.nodes.some((n) => n.id === id) && (!current || current.x !== p.x || current.y !== p.y);
          });
          if (changed.length === 0) return d;
          return {
            ...d,
            layout: { ...d.layout, ...Object.fromEntries(changed.map(([id, p]) => [id, roundPosition(p)])) },
          };
        }),

      renameNode: (id, label) =>
        commit((d) => updateNode(d, id, (n) => ({ ...n, label: label.slice(0, LIMITS.labelLength) })), {
          coalesceKey: `label:${id}`,
        }),

      setNodeConfig: (id, key, value) =>
        commit(
          (d) =>
            updateNode(d, id, (n) => {
              const config = { ...n.config } as Record<string, unknown>;
              if (value === undefined) delete config[key];
              else config[key] = value;
              return { ...n, config } as typeof n;
            }),
          { coalesceKey: `config:${id}:${key}` },
        ),

      setNodeFlow: (id, operation, steps, options) =>
        commit((d) => setFlow(d, id, operation, steps), options),

      setEdgeLabel: (id, label) =>
        commit(
          (d) => ({
            ...d,
            edges: d.edges.map((e) => {
              if (e.id !== id) return e;
              const trimmed = label.slice(0, LIMITS.labelLength);
              if (trimmed.trim() === "") {
                const { label: _removed, ...rest } = e;
                return rest;
              }
              return { ...e, label: trimmed };
            }),
          }),
          { coalesceKey: `edge-label:${id}` },
        ),

      deleteSelection: () => {
        const { selection } = get();
        if (selection.nodeIds.length === 0 && selection.edgeIds.length === 0) return;
        commit((d) => removeNodes(removeEdges(d, selection.edgeIds), selection.nodeIds));
        set({ selection: EMPTY_SELECTION });
      },

      deleteEdges: (ids) => commit((d) => removeEdges(d, ids)),

      duplicateSelection: () => {
        const { doc, selection } = get();
        if (selection.nodeIds.length === 0) return { ok: false, reason: "Select components to duplicate." };
        if (doc.nodes.length + selection.nodeIds.length > LIMITS.nodes) {
          return { ok: false, reason: `A design can have at most ${LIMITS.nodes} components.` };
        }
        const { doc: next, nodeIds } = duplicateNodes(doc, selection.nodeIds);
        commit(() => next);
        set({ selection: { nodeIds, edgeIds: [] } });
        return { ok: true, value: nodeIds };
      },

      addOperation: () => {
        const { doc } = get();
        if (doc.operations.length >= LIMITS.operations) return null;
        const name = uniqueName(
          "New operation",
          doc.operations.map((o) => o.name),
        );
        const id = operationIdFromName(
          name,
          doc.operations.map((o) => o.id),
        );
        commit((d) => ({ ...d, operations: [...d.operations, { id, name, kind: "read", share: 1 }] }));
        return id;
      },

      updateOperation: (id, patch) =>
        commit(
          (d) => ({ ...d, operations: d.operations.map((o) => (o.id === id ? { ...o, ...patch } : o)) }),
          { coalesceKey: `operation:${id}:${Object.keys(patch).sort().join(",")}` },
        ),

      deleteOperation: (id) => {
        if (get().doc.operations.length <= 1) return;
        commit((d) => removeOperation(d, id));
      },

      setNotes: (notes) =>
        commit(
          (d) => {
            const text = notes.slice(0, LIMITS.notesLength);
            if (text === "") {
              const { notes: _removed, ...rest } = d;
              return rest;
            }
            return { ...d, notes: text };
          },
          { coalesceKey: "notes" },
        ),

      setTraffic: (traffic) =>
        commit(
          (d) =>
            d.traffic?.totalRps === traffic.totalRps && sameMix(d.traffic.mix, traffic.mix)
              ? d
              : { ...d, traffic },
          { coalesceKey: "traffic" },
        ),

      setFailures: (failures) => set({ scenario: pruneScenario({ failures }, get().doc) }),
    };
  });
}

/** Drops failures whose component was removed or no longer accepts them, and merges duplicates. */
function pruneScenario(scenario: FailureScenario, doc: ArchitectureDocument): FailureScenario {
  if (scenario.failures.length === 0) return scenario;
  const { failures } = normalizeScenario(doc, scenario);
  const unchanged =
    failures.length === scenario.failures.length &&
    failures.every((f, i) => JSON.stringify(f) === JSON.stringify(scenario.failures[i]));
  return unchanged ? scenario : { failures };
}

function sameMix(a: TrafficProfile["mix"], b: TrafficProfile["mix"]): boolean {
  if (!a || !b) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

function pruneSelection(selection: Selection, doc: ArchitectureDocument): Selection {
  const nodeIds = selection.nodeIds.filter((id) => doc.nodes.some((n) => n.id === id));
  const edgeIds = selection.edgeIds.filter((id) => doc.edges.some((e) => e.id === id));
  return nodeIds.length === selection.nodeIds.length && edgeIds.length === selection.edgeIds.length
    ? selection
    : { nodeIds, edgeIds };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function roundPosition(p: Position): Position {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}
