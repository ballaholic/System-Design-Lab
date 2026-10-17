import { CircleAlert, CircleCheck, CloudOff, Loader2, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Persistence } from "../persistence/saveStatus";

/** Always-visible save state (PG-9): icon plus text, never colour alone. */
export function SaveIndicator({ persistence }: { persistence: Persistence }) {
  const { status, target } = persistence;
  const config = {
    saved: {
      icon: CircleCheck,
      text: target === "browser" ? "Saved in this browser" : "Saved",
      className: "text-muted-foreground",
    },
    unsaved: { icon: PencilLine, text: "Unsaved changes", className: "text-muted-foreground" },
    saving: { icon: Loader2, text: "Saving…", className: "text-muted-foreground" },
    offline: { icon: CloudOff, text: "Offline: changes kept on this device", className: "text-warning" },
    conflict: { icon: CircleAlert, text: "Changed elsewhere", className: "text-warning" },
    error: { icon: CircleAlert, text: "Not saved", className: "text-destructive" },
  }[status];
  const Icon = config.icon;

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-1.5 whitespace-nowrap text-xs", config.className)}
      title={persistence.error ?? undefined}
    >
      <Icon className={cn("size-3.5", status === "saving" && "animate-spin")} aria-hidden />
      <span className="hidden sm:inline">{config.text}</span>
      <span className="sr-only sm:hidden">{config.text}</span>
    </span>
  );
}
