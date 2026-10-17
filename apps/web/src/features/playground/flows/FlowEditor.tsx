import {
  type ArchitectureDocument,
  type ArchNode,
  CATALOG,
  type FlowNode,
  type FlowStep,
  flowsOf,
  LIMITS,
  type Operation,
  roleOf,
} from "@sdl/architecture";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Settings2, Trash2 } from "lucide-react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useEditor, useEditorStore } from "../store/editorContext";
import { appendStep, moveStepAt, removeStepAt, type StepPath, updateStepAt } from "./stepPaths";

interface FlowContext {
  doc: ArchitectureDocument;
  node: FlowNode;
  operation: Operation;
  steps: FlowStep[];
  setSteps: (steps: FlowStep[]) => void;
}

/** Per-operation flows of a service or worker (PG-3, ARCHITECTURE §6.2). */
export function FlowEditor({ node }: { node: FlowNode }) {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const flows = flowsOf(node);
  const isWorker = roleOf(node.type) === "consumer";

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        {isWorker
          ? "What this worker does with each message it consumes. A worker only processes messages it has a flow for."
          : "What this server does for each operation, step by step. Load balancers only send an operation to servers that have a flow for it."}
      </p>
      {doc.operations.map((operation) => {
        const steps = flows[operation.id];
        const setSteps = (next: FlowStep[] | null) =>
          store.getState().setNodeFlow(node.id, operation.id, next);
        if (!steps) {
          return (
            <div
              key={operation.id}
              className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2"
            >
              <span className="min-w-0 text-sm">
                <span className="font-medium">{operation.name}</span>{" "}
                <span className="text-xs text-muted-foreground">not handled</span>
              </span>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setSteps([])}>
                Handle
              </Button>
            </div>
          );
        }
        return (
          <section key={operation.id} aria-label={`${operation.name} flow`} className="rounded-md border">
            <header className="flex items-center gap-2 border-b px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{operation.name}</span>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                {operation.kind}
              </Badge>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Stop handling ${operation.name}`}
                title="Stop handling this operation"
                onClick={() => setSteps(null)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </header>
            <div className="p-2">
              <StepList
                ctx={{ doc, node, operation, steps, setSteps }}
                list={steps}
                listPath={[]}
                depth={1}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StepList({
  ctx,
  list,
  listPath,
  depth,
}: {
  ctx: FlowContext;
  list: FlowStep[];
  listPath: StepPath;
  depth: number;
}) {
  return (
    <div className="grid gap-1.5">
      {list.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {depth === 1 ? "No steps: requests succeed here without calling anything." : "No on-miss steps."}
        </p>
      )}
      <ol className="grid gap-1.5">
        {list.map((step, i) => (
          <StepRow
            key={`${step.edge}-${i}`}
            ctx={ctx}
            step={step}
            path={[...listPath, i]}
            index={i}
            count={list.length}
            depth={depth}
          />
        ))}
      </ol>
      <AddStepMenu ctx={ctx} listPath={listPath} depth={depth} />
    </div>
  );
}

function targetOf(ctx: FlowContext, step: FlowStep): ArchNode | undefined {
  const edge = ctx.doc.edges.find((e) => e.id === step.edge);
  return edge && ctx.doc.nodes.find((n) => n.id === edge.target);
}

function describe(ctx: FlowContext, step: FlowStep): string {
  const target = targetOf(ctx, step)?.label ?? "a missing connection";
  switch (step.type) {
    case "call":
      return targetOf(ctx, step) && CATALOG[targetOf(ctx, step)!.type].role === "cache"
        ? `Write to ${target}`
        : `Call ${target}`;
    case "cache-lookup":
      return `Look up in ${target}`;
    case "publish":
      return `Publish to ${target}`;
  }
}

function StepRow({
  ctx,
  step,
  path,
  index,
  count,
  depth,
}: {
  ctx: FlowContext;
  step: FlowStep;
  path: StepPath;
  index: number;
  count: number;
  depth: number;
}) {
  const update = (fn: (s: FlowStep) => FlowStep) => ctx.setSteps(updateStepAt(ctx.steps, path, fn));
  const label = describe(ctx, step);
  const opName = (id: string | undefined) => ctx.doc.operations.find((o) => o.id === id)?.name ?? id;
  const chips: string[] = [];
  if (step.type === "call") {
    if (step.operation) chips.push(`as ${opName(step.operation)}`);
    if (step.as) chips.push(`${step.as}s`);
    if (step.optional) chips.push("optional");
  } else if (step.type === "publish") {
    if (step.message) chips.push(`message ${opName(step.message)}`);
    if (step.optional) chips.push("optional");
  } else if (step.populate) {
    chips.push("populate on miss");
  }

  return (
    <li className="rounded-md bg-muted/50 px-2 py-1.5">
      <div className="flex items-center gap-1">
        <span className="w-4 shrink-0 text-center font-mono text-[10px] text-muted-foreground">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{label}</div>
          {chips.length > 0 && (
            <div className="truncate text-[10px] text-muted-foreground">{chips.join(" · ")}</div>
          )}
        </div>
        <StepSettings ctx={ctx} step={step} label={label} update={update} />
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label={`Move "${label}" up`}
          disabled={index === 0}
          onClick={() => ctx.setSteps(moveStepAt(ctx.steps, path, -1))}
        >
          <ArrowUp className="size-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label={`Move "${label}" down`}
          disabled={index === count - 1}
          onClick={() => ctx.setSteps(moveStepAt(ctx.steps, path, 1))}
        >
          <ArrowDown className="size-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label={`Remove "${label}"`}
          onClick={() => ctx.setSteps(removeStepAt(ctx.steps, path))}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
      {step.type === "cache-lookup" && (
        <div className="mt-1.5 border-l-2 pl-2">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            On miss
          </div>
          <StepList ctx={ctx} list={step.onMiss} listPath={path} depth={depth + 1} />
        </div>
      )}
    </li>
  );
}

const DEFAULT = "default";

function StepSettings({
  ctx,
  step,
  label,
  update,
}: {
  ctx: FlowContext;
  step: FlowStep;
  label: string;
  update: (fn: (s: FlowStep) => FlowStep) => void;
}) {
  const id = useId();
  const operations = ctx.doc.operations;
  const without = <T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> => {
    const { [key]: _removed, ...rest } = obj;
    return rest;
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="size-6" aria-label={`Settings for "${label}"`}>
          <Settings2 className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-72 gap-3 text-xs">
        <p className="font-medium">{label}</p>
        {step.type === "cache-lookup" && (
          <ToggleRow
            id={`${id}-populate`}
            label="Populate on miss"
            help="After a miss, write the value back to the cache (best effort; uses spare cache capacity)."
            checked={step.populate ?? false}
            onChange={(v) =>
              update((s) =>
                v
                  ? { ...s, populate: true }
                  : without(s as Extract<FlowStep, { type: "cache-lookup" }>, "populate"),
              )
            }
          />
        )}
        {step.type === "call" && (
          <>
            <SelectRow
              id={`${id}-op`}
              label="Operation sent"
              help="Which operation the target sees. By default it's the same as this flow's."
              value={step.operation ?? DEFAULT}
              options={[
                { value: DEFAULT, label: `Same (${ctx.operation.name})` },
                ...operations.map((o) => ({ value: o.id, label: o.name })),
              ]}
              onChange={(v) =>
                update((s) =>
                  v === DEFAULT
                    ? without(s as Extract<FlowStep, { type: "call" }>, "operation")
                    : { ...s, operation: v },
                )
              }
            />
            <SelectRow
              id={`${id}-as`}
              label="Store capacity used"
              help="For databases: whether this call uses read or write capacity. By default it follows the operation's kind."
              value={step.as ?? DEFAULT}
              options={[
                { value: DEFAULT, label: "From the operation" },
                { value: "read", label: "Read" },
                { value: "write", label: "Write" },
              ]}
              onChange={(v) =>
                update((s) =>
                  v === DEFAULT
                    ? without(s as Extract<FlowStep, { type: "call" }>, "as")
                    : { ...s, as: v as "read" | "write" },
                )
              }
            />
          </>
        )}
        {step.type === "publish" && (
          <SelectRow
            id={`${id}-msg`}
            label="Message"
            help="The operation workers handle for this message. By default it's the same as this flow's."
            value={step.message ?? DEFAULT}
            options={[
              { value: DEFAULT, label: `Same (${ctx.operation.name})` },
              ...operations.map((o) => ({ value: o.id, label: o.name })),
            ]}
            onChange={(v) =>
              update((s) =>
                v === DEFAULT
                  ? without(s as Extract<FlowStep, { type: "publish" }>, "message")
                  : { ...s, message: v },
              )
            }
          />
        )}
        {(step.type === "call" || step.type === "publish") && (
          <ToggleRow
            id={`${id}-optional`}
            label="Optional"
            help="If this step fails, the request still succeeds (best effort, e.g. cache updates)."
            checked={step.optional ?? false}
            onChange={(v) =>
              update((s) =>
                v
                  ? { ...s, optional: true }
                  : without(s as Extract<FlowStep, { type: "call" | "publish" }>, "optional"),
              )
            }
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ToggleRow({
  id,
  label,
  help,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
      </div>
      <p className="text-muted-foreground">{help}</p>
    </div>
  );
}

function SelectRow({
  id,
  label,
  help,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} size="sm" className="h-7 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground">{help}</p>
    </div>
  );
}

function AddStepMenu({ ctx, listPath, depth }: { ctx: FlowContext; listPath: StepPath; depth: number }) {
  const outgoing = ctx.doc.edges.filter((e) => e.source === ctx.node.id);
  const options: Array<{ label: string; step: FlowStep }> = [];
  for (const edge of outgoing) {
    const target = ctx.doc.nodes.find((n) => n.id === edge.target);
    if (!target) continue;
    const role = CATALOG[target.type].role;
    if (role === "cache") {
      if (depth < LIMITS.flowNesting) {
        options.push({
          label: `Look up in ${target.label}`,
          step: { type: "cache-lookup", edge: edge.id, onMiss: [], populate: true },
        });
      }
      options.push({
        label: `Write to ${target.label}`,
        step: { type: "call", edge: edge.id, as: "write", optional: true },
      });
    } else if (role === "queue" || role === "stream") {
      options.push({ label: `Publish to ${target.label}`, step: { type: "publish", edge: edge.id } });
    } else if (role === "store" || role === "service" || role === "distributor") {
      options.push({ label: `Call ${target.label}`, step: { type: "call", edge: edge.id } });
    }
  }

  if (options.length === 0) {
    return depth === 1 ? (
      <p className="px-1 text-xs text-muted-foreground">
        Connect this component to a database, cache, queue or service to add steps.
      </p>
    ) : null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-fit gap-1 px-2 text-xs">
          <Plus className="size-3" />
          {depth === 1 ? "Add step" : "Add on-miss step"}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel className="text-xs">Uses a connection from {ctx.node.label}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem
            key={o.label}
            onSelect={() => ctx.setSteps(appendStep(ctx.steps, listPath, o.step))}
          >
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
