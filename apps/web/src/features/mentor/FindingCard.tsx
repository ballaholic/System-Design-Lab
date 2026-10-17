import { useReactFlow } from "@xyflow/react";
import { Crosshair } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import type { Level, ReviewFinding } from "@/lib/api/mentor";
import { cn } from "@/lib/utils";
import { useEditor, useEditorStore } from "../playground/store/editorContext";

const SEVERITY: Record<Level, { label: string; className: string }> = {
  high: { label: "High", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  medium: { label: "Medium", className: "border-warning/40 bg-warning/10 text-warning" },
  low: { label: "Low", className: "border-border bg-muted text-muted-foreground" },
};

const CATEGORY: Record<ReviewFinding["category"], string> = {
  capacity: "Capacity",
  availability: "Availability",
  "data-flow": "Data flow",
  requirements: "Requirements",
  simplicity: "Simplicity",
  other: "Other",
};

/**
 * One Reviewer finding (PRD AI-4). Hovering or focusing a component chip (or "Show on canvas") points it out on the
 * canvas; clicking selects it and moves the view there. Severity and confidence are spelled out, never colour alone.
 */
export function FindingCard({ finding }: { finding: ReviewFinding }) {
  const store = useEditorStore();
  const nodes = useEditor((s) => s.doc.nodes);
  const showNodes = useShowNodes();
  const related = finding.nodeIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => n !== undefined);
  const severity = SEVERITY[finding.severity];
  const point = (ids: string[]) => store.setState({ highlight: ids });

  return (
    <article aria-label={finding.title} className="grid gap-1.5 rounded-lg border p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={cn("rounded border px-1.5 py-px font-medium", severity.className)}>
          {severity.label} severity
        </span>
        <span className="text-muted-foreground">{CATEGORY[finding.category]}</span>
        <span className="ml-auto text-muted-foreground">Confidence: {finding.confidence}</span>
      </div>
      <h4 className="font-medium leading-snug">{finding.title}</h4>
      <Markdown className="text-xs text-muted-foreground">{finding.explanation}</Markdown>
      {finding.suggestion && (
        <p className="text-xs">
          <span className="font-medium">Suggestion: </span>
          {finding.suggestion}
        </p>
      )}
      {related.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {related.map((n) => (
            <button
              key={n.id}
              type="button"
              className="rounded bg-muted px-1.5 py-0.5 text-[11px] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onMouseEnter={() => point([n.id])}
              onMouseLeave={() => point([])}
              onFocus={() => point([n.id])}
              onBlur={() => point([])}
              onClick={() => showNodes([n.id])}
            >
              {n.label}
            </button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-xs"
            onMouseEnter={() => point(finding.nodeIds)}
            onMouseLeave={() => point([])}
            onFocus={() => point(finding.nodeIds)}
            onBlur={() => point([])}
            onClick={() => showNodes(finding.nodeIds)}
          >
            <Crosshair className="size-3.5" /> Show on canvas
          </Button>
        </div>
      )}
    </article>
  );
}

/** Selects the components a finding is about and moves the canvas to them. */
function useShowNodes() {
  const store = useEditorStore();
  const { fitView } = useReactFlow();
  return (nodeIds: string[]) => {
    if (nodeIds.length === 0) return;
    store.getState().setSelection({ nodeIds, edgeIds: [] });
    void fitView({ nodes: nodeIds.map((id) => ({ id })), duration: 300, maxZoom: 1.2 });
  };
}
