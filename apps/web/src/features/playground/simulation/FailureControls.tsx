import type { ArchNode } from "@sdl/architecture";
import { describeFailure, failuresFor } from "@sdl/simulation";
import { X, Zap } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenuCheckboxItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSyncedState } from "@/lib/useSyncedState";
import { cn } from "@/lib/utils";
import { useEditor } from "../store/editorContext";
import { useFailures } from "./useFailures";

function instancesOf(node: ArchNode): number {
  return (node.config as { instances?: number }).instances ?? 1;
}

/** Switches for every failure that applies to one component (inspector and toolbar menu). */
export function NodeFailureControls({ node, compact = false }: { node: ArchNode; compact?: boolean }) {
  const { find, set } = useFailures();
  const baseId = useId();
  return (
    <div className="grid gap-2">
      {failuresFor(node.type).map((def) => {
        const active = find(node.id, def.kind);
        const id = `${baseId}-${def.kind}`;
        return (
          <div key={def.kind} className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={id} className="text-sm font-normal">
                {compact ? node.label : def.label}
              </Label>
              <Switch
                id={id}
                aria-label={compact ? `${node.label}: ${def.label}` : undefined}
                checked={active !== undefined}
                onCheckedChange={(on) => set(node.id, def.kind, on)}
              />
            </div>
            {!compact && <p className="text-xs text-muted-foreground">{def.description}</p>}
            {def.hasCount && active?.kind === "app-instance-failure" && (
              <InstanceCount
                instances={instancesOf(node)}
                count={active.count}
                onChange={(count) => set(node.id, def.kind, count)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function InstanceCount({
  instances,
  count,
  onChange,
}: {
  instances: number;
  count: number;
  onChange(count: number): void;
}) {
  const id = useId();
  const [text, setText] = useSyncedState(String(count));
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        Failed instances
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={instances}
        value={text}
        className="h-7 w-20 text-sm"
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (Number.isInteger(n) && n >= 1 && n <= instances) onChange(n);
        }}
        onBlur={() => setText(String(count))}
      />
      <span className="text-xs text-muted-foreground">of {instances}</span>
    </div>
  );
}

/** Failure items for a component's context menu on the canvas. */
export function NodeFailureMenuItems({ node }: { node: ArchNode }) {
  const { find, set } = useFailures();
  const defs = failuresFor(node.type);
  if (defs.length === 0) {
    return (
      <DropdownMenuLabel className="font-normal text-muted-foreground">No failures apply</DropdownMenuLabel>
    );
  }
  return defs.flatMap((def) => {
    const active = find(node.id, def.kind);
    if (!def.hasCount) {
      return [
        <DropdownMenuCheckboxItem
          key={def.kind}
          checked={active !== undefined}
          onCheckedChange={(on) => set(node.id, def.kind, on)}
        >
          {def.label}
        </DropdownMenuCheckboxItem>,
      ];
    }
    const instances = instancesOf(node);
    const options = [...new Set([1, Math.ceil(instances / 2), instances])];
    return options.map((count) => (
      <DropdownMenuCheckboxItem
        key={`${def.kind}-${count}`}
        checked={active?.kind === "app-instance-failure" && active.count === count}
        onCheckedChange={(on) => set(node.id, def.kind, on ? count : false)}
      >
        {count === instances ? "All instances fail" : `${count} of ${instances} instances fail`}
      </DropdownMenuCheckboxItem>
    ));
  });
}

/** Toolbar menu: every component a failure can be injected into. */
export function FailuresMenu() {
  const nodes = useEditor((s) => s.doc.nodes);
  const { failures, clear } = useFailures();
  const targets = nodes.filter((n) => failuresFor(n.type).length > 0);
  const label = failures.length > 0 ? `Failures (${failures.length} injected)` : "Inject failures";

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className={cn("relative size-8", failures.length > 0 && "text-destructive")}
              aria-label={label}
            >
              <Zap className="size-4" />
              {failures.length > 0 && (
                <span
                  className="absolute right-0.5 top-0.5 flex size-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-semibold text-white"
                  aria-hidden
                >
                  {failures.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80">
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Failure injection</h3>
            {failures.length > 0 && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clear}>
                Clear all
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Failures apply to this session&apos;s simulation only and aren&apos;t saved with the design.
          </p>
          {targets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add a database, cache, API server or background worker to inject failures.
            </p>
          ) : (
            <div className="grid max-h-72 gap-3 overflow-y-auto pr-1">
              {targets.map((node) => (
                <NodeFailureControls key={node.id} node={node} compact />
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Active failures as removable chips. */
export function FailureChips() {
  const nodes = useEditor((s) => s.doc.nodes);
  const { failures, set } = useFailures();
  if (failures.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Injected failures">
      {failures.map((f) => {
        const text = describeFailure(
          f,
          nodes.find((n) => n.id === f.nodeId),
        );
        return (
          <li
            key={`${f.kind}-${f.nodeId}`}
            className="flex h-6 items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 pl-2 pr-0.5 text-xs text-destructive"
          >
            <Zap className="size-3" aria-hidden />
            <span className="max-w-48 truncate">{text}</span>
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-full hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove failure: ${text}`}
              onClick={() => set(f.nodeId, f.kind, false)}
            >
              <X className="size-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
