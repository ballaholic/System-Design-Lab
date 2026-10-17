import type { ValidationIssue } from "@sdl/architecture";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlaygroundUi } from "../playgroundUi";
import { issueCounts } from "./issueCounts";
import { useEditor, useEditorStore } from "../store/editorContext";

const ORDER = { error: 0, warning: 1, info: 2 } as const;

/** Continuous validation results (PG-7). Errors block simulation; warnings don't. */
export function IssuesPanel() {
  const issues = useEditor((s) => s.issues);
  const nodeCount = useEditor((s) => s.doc.nodes.length);
  const store = useEditorStore();
  const ui = usePlaygroundUi();
  const sorted = [...issues].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const { errors, warnings } = issueCounts(issues);

  if (issues.length === 0) {
    return (
      <div className="flex items-start gap-2 p-4 text-sm">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <p>{nodeCount === 0 ? "Nothing to check yet. Add components to start." : "No problems found."}</p>
      </div>
    );
  }

  const select = (issue: ValidationIssue) => {
    const nodeIds = issue.nodeIds ?? [];
    const edgeIds = issue.edgeIds ?? [];
    if (nodeIds.length === 1 && edgeIds.length === 0) ui.focusNode(nodeIds[0]!);
    else store.getState().setSelection({ nodeIds, edgeIds });
  };

  return (
    <div className="grid gap-2 p-3">
      <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
        {errors > 0
          ? `${errors} error${errors === 1 ? "" : "s"} must be fixed before simulating.`
          : "No errors. Warnings point at parts of the design that may not do what you expect."}
        {warnings > 0 && errors > 0 && ` ${warnings} warning${warnings === 1 ? "" : "s"}.`}
      </p>
      <ul className="grid gap-1.5">
        {sorted.map((issue, i) => {
          const Icon =
            issue.severity === "error" ? CircleAlert : issue.severity === "warning" ? TriangleAlert : Info;
          const linked = (issue.nodeIds?.length ?? 0) + (issue.edgeIds?.length ?? 0) > 0;
          const content = (
            <>
              <Icon
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  issue.severity === "error"
                    ? "text-destructive"
                    : issue.severity === "warning"
                      ? "text-warning"
                      : "text-info",
                )}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="sr-only">{issue.severity}: </span>
                {issue.message}
              </span>
            </>
          );
          return (
            <li key={`${issue.code}-${i}`}>
              {linked ? (
                <button
                  type="button"
                  onClick={() => select(issue)}
                  className="flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {content}
                </button>
              ) : (
                <div className="flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
