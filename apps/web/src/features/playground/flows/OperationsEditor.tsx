import { LIMITS, type Operation } from "@sdl/architecture";
import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSyncedState } from "@/lib/useSyncedState";
import { formatPercent } from "../catalogUi";
import { useEditor, useEditorStore } from "../store/editorContext";

/** Document-level operations: the request types users send and their traffic mix (ARCHITECTURE §6.2). */
export function OperationsEditor() {
  const store = useEditorStore();
  const operations = useEditor((s) => s.doc.operations);
  const total = operations.reduce((sum, o) => sum + o.share, 0);
  const reads = operations.filter((o) => o.kind === "read").reduce((sum, o) => sum + o.share, 0);

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        The kinds of requests users send. Share is the relative weight in the traffic mix; 0 marks an
        internal, message-only operation.
      </p>
      <ul className="grid gap-1.5">
        {operations.map((op) => (
          <OperationRow
            key={op.id}
            operation={op}
            canRemove={operations.length > 1}
            onChange={(patch) => store.getState().updateOperation(op.id, patch)}
            onRemove={() => store.getState().deleteOperation(op.id)}
          />
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          disabled={operations.length >= LIMITS.operations}
          onClick={() => store.getState().addOperation()}
        >
          <Plus className="size-3" /> Add operation
        </Button>
        {total > 0 && (
          <span className="text-xs text-muted-foreground">
            Reads {formatPercent(reads / total)} · writes {formatPercent((total - reads) / total)}
          </span>
        )}
      </div>
    </div>
  );
}

function OperationRow({
  operation,
  canRemove,
  onChange,
  onRemove,
}: {
  operation: Operation;
  canRemove: boolean;
  onChange: (patch: Partial<Omit<Operation, "id">>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const [name, setName] = useSyncedState(operation.name);
  const [share, setShare] = useSyncedState(String(operation.share));

  return (
    <li className="grid gap-1.5 rounded-md border p-2">
      <div className="flex items-center gap-1.5">
        <Input
          aria-label="Operation name"
          value={name}
          maxLength={LIMITS.operationNameLength}
          className="h-7 text-xs"
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) onChange({ name: e.target.value.trim() });
          }}
          onBlur={() => setName(operation.name)}
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          aria-label={`Remove ${operation.name}`}
          disabled={!canRemove}
          title={canRemove ? "Remove operation and its flows" : "A design needs at least one operation"}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Select
          value={operation.kind}
          onValueChange={(kind) => onChange({ kind: kind as Operation["kind"] })}
        >
          <SelectTrigger
            id={`${id}-kind`}
            size="sm"
            aria-label={`Kind of ${operation.name}`}
            className="h-7 w-full text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="read">Read</SelectItem>
            <SelectItem value="write">Write</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative">
          <Input
            aria-label={`Share of ${operation.name}`}
            inputMode="decimal"
            value={share}
            className="h-7 pr-10 font-mono text-xs"
            onChange={(e) => {
              setShare(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 1_000_000)
                onChange({ share: n });
            }}
            onBlur={() => setShare(String(operation.share))}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            share
          </span>
        </div>
      </div>
    </li>
  );
}
