import type { FieldMeta, Operation } from "@sdl/architecture";
import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSyncedState } from "@/lib/useSyncedState";
import { formatNumber } from "../catalogUi";

interface FieldProps {
  fieldKey: string;
  meta: FieldMeta;
  value: unknown;
  operations: Operation[];
  onChange: (value: unknown) => void;
}

/** One inspector field generated from catalog metadata (PG-4). */
export function ConfigField(props: FieldProps) {
  switch (props.meta.kind) {
    case "number":
    case "ratio":
      return <NumberField {...props} meta={props.meta} />;
    case "operations":
      return <OperationsField {...props} meta={props.meta} />;
  }
}

function NumberField({
  meta,
  value,
  onChange,
}: FieldProps & { meta: Extract<FieldMeta, { kind: "number" | "ratio" }> }) {
  const id = useId();
  const isRatio = meta.kind === "ratio";
  const optional = meta.kind === "number" && meta.optional;
  const min = isRatio ? 0 : meta.min;
  const max = isRatio ? 100 : meta.max;
  const integer = meta.kind === "number" ? meta.integer : false;
  const toText = (v: unknown) => (typeof v === "number" ? String(isRatio ? round(v * 100) : v) : "");
  // Follows external changes (undo, redo) but keeps what the user typed if it already means the same value.
  const [text, setText] = useSyncedState<unknown, string>(value, (v, current) =>
    current !== undefined && parse(current) === v ? current : toText(v),
  );

  function parse(raw: string): number | undefined | null {
    const trimmed = raw.trim().replace(/[,_\s]/g, "");
    if (trimmed === "") return optional ? undefined : null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    if (n < min || n > max || (integer && !Number.isInteger(n))) return null;
    return isRatio ? round(n / 100, 4) : n;
  }

  const invalid = parse(text) === null;
  const error = !invalid
    ? null
    : text.trim() === ""
      ? "Required."
      : `Enter ${integer ? "a whole number" : "a number"} from ${formatNumber(min)} to ${formatNumber(max)}${isRatio ? "%" : ""}.`;

  const commit = (raw: string) => {
    setText(raw);
    const parsed = parse(raw);
    if (parsed !== null && parsed !== value) onChange(parsed);
  };

  const unit = isRatio ? "%" : meta.kind === "number" ? meta.unit : undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {meta.label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      <div className="relative">
        <Input
          id={id}
          inputMode={integer ? "numeric" : "decimal"}
          value={text}
          placeholder={optional ? "Not set" : undefined}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => {
            if (invalid) setText(toText(value));
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          className={unit ? "h-8 pr-16 font-mono text-sm" : "h-8 font-mono text-sm"}
        />
        {unit && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {meta.help}
      </p>
    </div>
  );
}

function OperationsField({
  meta,
  value,
  operations,
  onChange,
}: FieldProps & { meta: Extract<FieldMeta, { kind: "operations" }> }) {
  const id = useId();
  const selected = Array.isArray(value) ? (value as string[]) : null;
  const all = selected === null;

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-xs font-medium">{meta.label}</legend>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${id}-all`} className="text-xs font-normal">
          {meta.whenUnset}
        </Label>
        <Switch
          id={`${id}-all`}
          size="sm"
          checked={all}
          onCheckedChange={(checked) => onChange(checked ? undefined : operations.map((o) => o.id))}
        />
      </div>
      {!all && (
        <ul className="grid gap-1.5 rounded-md border p-2">
          {operations.map((op) => (
            <li key={op.id} className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${op.id}`}
                checked={selected.includes(op.id)}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...selected, op.id] : selected.filter((x) => x !== op.id))
                }
              />
              <Label htmlFor={`${id}-${op.id}`} className="text-xs font-normal">
                {op.name} <span className="text-muted-foreground">({op.kind})</span>
              </Label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{meta.help}</p>
    </fieldset>
  );
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
