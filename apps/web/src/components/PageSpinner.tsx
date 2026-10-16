import { LoaderCircle } from "lucide-react";

export function PageSpinner({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      <span>{label}…</span>
    </div>
  );
}
