import { useId, type ComponentProps } from "react";
import type { FieldError } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormFieldProps = ComponentProps<typeof Input> & {
  label: string;
  error?: FieldError | undefined;
  hint?: string;
};

/** Label + input + error/hint, wired for accessibility. Use with react-hook-form's register(). */
export function FormField({ label, error, hint, id, ...inputProps }: FormFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const message = error?.message ?? hint;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        {...inputProps}
      />
      {message && (
        <p id={messageId} className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {message}
        </p>
      )}
    </div>
  );
}
