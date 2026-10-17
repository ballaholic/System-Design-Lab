import {
  CATALOG,
  checkConnection,
  flowUsages,
  isFlowNode,
  LIMITS,
  roleOf,
  suggestSteps,
  type ArchEdge,
  type ArchNode,
} from "@sdl/architecture";
import { ArrowRight, Copy, Lightbulb, Trash2 } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSyncedState } from "@/lib/useSyncedState";
import { formatNumber, ICONS } from "../catalogUi";
import { edgeCarries } from "../canvas/toFlow";
import { FlowEditor } from "../flows/FlowEditor";
import { OperationsEditor } from "../flows/OperationsEditor";
import { usePlaygroundUi } from "../playgroundUi";
import { useEditor, useEditorStore } from "../store/editorContext";
import { ConfigField } from "./ConfigField";

export function Inspector() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const total = selection.nodeIds.length + selection.edgeIds.length;

  if (total === 0) return <DocumentInspector />;
  if (total > 1) return <MultiInspector nodes={selection.nodeIds.length} edges={selection.edgeIds.length} />;
  const node = doc.nodes.find((n) => n.id === selection.nodeIds[0]);
  if (node) return <NodeInspector key={node.id} node={node} />;
  const edge = doc.edges.find((e) => e.id === selection.edgeIds[0]);
  if (edge) return <EdgeInspector key={edge.id} edge={edge} />;
  return <DocumentInspector />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-3 p-4">
      <h3 id={id} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Text input that commits on every valid keystroke and follows external changes such as undo. */
function TextField({
  label,
  value,
  maxLength,
  required,
  onChange,
}: {
  label: string;
  value: string;
  maxLength: number;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [text, setText] = useSyncedState(value);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={text}
        maxLength={maxLength}
        className="h-8 text-sm"
        onChange={(e) => {
          setText(e.target.value);
          if (!required || e.target.value.trim()) onChange(e.target.value);
        }}
        onBlur={() => setText(value)}
      />
    </div>
  );
}

function DocumentInspector() {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const id = useId();
  const [notes, setNotes] = useSyncedState(doc.notes ?? "");

  return (
    <div className="divide-y">
      <Section title="Design">
        <p className="text-sm text-muted-foreground">
          {doc.nodes.length === 0
            ? "Add components from the library, connect them, then define what each server does in its flows."
            : `${doc.nodes.length} component${doc.nodes.length === 1 ? "" : "s"}, ${doc.edges.length} connection${doc.edges.length === 1 ? "" : "s"}. Select something to edit it.`}
        </p>
      </Section>
      <Section title="Operations">
        <OperationsEditor />
      </Section>
      <Section title="Notes">
        <Label htmlFor={id} className="sr-only">
          Design notes
        </Label>
        <Textarea
          id={id}
          value={notes}
          maxLength={LIMITS.notesLength}
          placeholder="Assumptions, requirements, open questions…"
          className="min-h-24 text-sm"
          onChange={(e) => {
            setNotes(e.target.value);
            store.getState().setNotes(e.target.value);
          }}
        />
      </Section>
    </div>
  );
}

function MultiInspector({ nodes, edges }: { nodes: number; edges: number }) {
  const ui = usePlaygroundUi();
  return (
    <Section title="Selection">
      <p className="text-sm">
        {nodes > 0 && `${nodes} component${nodes === 1 ? "" : "s"}`}
        {nodes > 0 && edges > 0 && " and "}
        {edges > 0 && `${edges} connection${edges === 1 ? "" : "s"}`} selected.
      </p>
      <div className="flex gap-2">
        {nodes > 0 && (
          <Button size="sm" variant="outline" onClick={ui.duplicate}>
            <Copy className="size-3.5" /> Duplicate
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={ui.requestDelete}>
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </div>
    </Section>
  );
}

function NodeInspector({ node }: { node: ArchNode }) {
  const store = useEditorStore();
  const ui = usePlaygroundUi();
  const doc = useEditor((s) => s.doc);
  const def = CATALOG[node.type];
  const Icon = ICONS[def.icon];

  return (
    <div className="divide-y">
      <div className="flex items-start gap-3 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{def.name}</h2>
          <p className="text-xs text-muted-foreground">{def.description}</p>
        </div>
      </div>
      <Section title="Settings">
        <TextField
          label="Label"
          value={node.label}
          maxLength={LIMITS.labelLength}
          required
          onChange={(v) => store.getState().renameNode(node.id, v.trim())}
        />
        {def.fields.map(({ key, meta }) => (
          <ConfigField
            key={key}
            fieldKey={key}
            meta={meta}
            value={(node.config as Record<string, unknown>)[key]}
            operations={doc.operations}
            onChange={(v) => store.getState().setNodeConfig(node.id, key, v)}
          />
        ))}
        <p className="text-xs text-muted-foreground">
          Default values are illustrative orders of magnitude, not benchmarks.
        </p>
      </Section>
      {isFlowNode(node) && (
        <Section title="Flows">
          <FlowEditor node={node} />
        </Section>
      )}
      <Section title="Connections">
        <ConnectionsList node={node} />
      </Section>
      <div className="flex gap-2 p-4">
        <Button size="sm" variant="outline" onClick={ui.duplicate}>
          <Copy className="size-3.5" /> Duplicate
        </Button>
        <Button size="sm" variant="outline" onClick={ui.requestDelete}>
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </div>
    </div>
  );
}

/** Lists connections and lets keyboard users create new ones without dragging. */
function ConnectionsList({ node }: { node: ArchNode }) {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const id = useId();
  const [target, setTarget] = useState("");
  const outgoing = doc.edges.filter((e) => e.source === node.id);
  const incoming = doc.edges.filter((e) => e.target === node.id);
  const label = (nodeId: string) => doc.nodes.find((n) => n.id === nodeId)?.label ?? "?";
  const candidates = doc.nodes.filter((n) => n.id !== node.id);

  const connect = (targetId: string) => {
    const result = store.getState().connect(node.id, targetId);
    if (!result.ok) toast.error("Can't connect", { description: result.reason });
    setTarget("");
  };

  return (
    <div className="grid gap-3 text-sm">
      {incoming.length === 0 && outgoing.length === 0 && (
        <p className="text-xs text-muted-foreground">Not connected yet.</p>
      )}
      {incoming.length > 0 && (
        <ul className="grid gap-1" aria-label="Incoming connections">
          {incoming.map((e) => (
            <li key={e.id}>
              <EdgeButton edgeId={e.id}>
                {label(e.source)} <ArrowRight className="size-3" aria-label="to" />{" "}
                <span className="text-muted-foreground">this</span>
              </EdgeButton>
            </li>
          ))}
        </ul>
      )}
      {outgoing.length > 0 && (
        <ul className="grid gap-1" aria-label="Outgoing connections">
          {outgoing.map((e) => (
            <li key={e.id}>
              <EdgeButton edgeId={e.id}>
                <span className="text-muted-foreground">this</span>{" "}
                <ArrowRight className="size-3" aria-label="to" /> {label(e.target)}
              </EdgeButton>
            </li>
          ))}
        </ul>
      )}
      {roleOf(node.type) !== "store" && roleOf(node.type) !== "cache" && candidates.length > 0 && (
        <div className="grid gap-1.5">
          <Label htmlFor={id} className="text-xs">
            Connect to…
          </Label>
          <Select value={target} onValueChange={connect}>
            <SelectTrigger id={id} size="sm" className="h-8 w-full text-xs">
              <SelectValue placeholder="Choose a component" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((n) => {
                const check = checkConnection(doc, node.id, n.id);
                return (
                  <SelectItem key={n.id} value={n.id} disabled={!check.ok} className="text-xs">
                    {n.label}
                    {!check.ok && <span className="text-muted-foreground"> (not allowed)</span>}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function EdgeButton({ edgeId, children }: { edgeId: string; children: ReactNode }) {
  const store = useEditorStore();
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onClick={() => store.getState().setSelection({ nodeIds: [], edgeIds: [edgeId] })}
    >
      {children}
    </button>
  );
}

function EdgeInspector({ edge }: { edge: ArchEdge }) {
  const store = useEditorStore();
  const ui = usePlaygroundUi();
  const doc = useEditor((s) => s.doc);
  const source = doc.nodes.find((n) => n.id === edge.source);
  const target = doc.nodes.find((n) => n.id === edge.target);
  const targetRole = target ? roleOf(target.type) : null;
  const carries = [...(edgeCarries(doc).get(edge.id) ?? [])].map(
    (id) => doc.operations.find((o) => o.id === id)?.name ?? id,
  );
  const usages = flowUsages(doc, [edge.id]);
  const suggestions = suggestSteps(doc, edge.id);
  const opName = (id: string) => doc.operations.find((o) => o.id === id)?.name ?? id;

  return (
    <div className="divide-y">
      <div className="grid gap-1 p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {source?.label} <ArrowRight className="size-3.5" aria-label="to" /> {target?.label}
        </h2>
        <p className="text-xs text-muted-foreground">
          {targetRole === "queue" || targetRole === "stream"
            ? "Asynchronous: the sender only waits for the broker to accept the message."
            : "Synchronous: the sender waits for the response."}
        </p>
      </div>
      <Section title="Traffic">
        {carries.length > 0 ? (
          <p className="text-sm">Carries {carries.join(", ")}.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Carries no traffic yet. Connections only carry traffic when a flow step uses them or a load
            balancer routes over them.
          </p>
        )}
        {usages.length > 0 && (
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {usages.map((u) => (
              <li key={`${u.nodeId}-${u.operation}`}>
                Used by the {opName(u.operation)} flow on {doc.nodes.find((n) => n.id === u.nodeId)?.label}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {suggestions.length > 0 && (
        <Section title="Suggested steps">
          <ul className="grid gap-2">
            {suggestions.map((s) => (
              <li key={s.operation} className="flex items-start gap-2 rounded-md border p-2">
                <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1 text-xs">
                  <span className="font-medium">{opName(s.operation)}:</span> {s.description}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() => store.getState().setNodeFlow(edge.source, s.operation, s.steps)}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Suggestions are never applied automatically. You can edit the steps in {source?.label}'s flows.
          </p>
        </Section>
      )}
      <Section title="Label">
        <TextField
          label="Connection label (optional)"
          value={edge.label ?? ""}
          maxLength={LIMITS.labelLength}
          onChange={(v) => store.getState().setEdgeLabel(edge.id, v)}
        />
      </Section>
      <div className="p-4">
        <Button size="sm" variant="outline" onClick={ui.requestDelete}>
          <Trash2 className="size-3.5" /> Delete connection
        </Button>
        {usages.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Deleting it also removes its steps from {formatNumber(usages.length)} flow
            {usages.length === 1 ? "" : "s"}.
          </p>
        )}
      </div>
    </div>
  );
}
