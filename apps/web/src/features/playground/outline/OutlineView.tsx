import {
  type ArchitectureDocument,
  CATALOG,
  CATEGORIES,
  type FlowStep,
  flowsOf,
  isFlowNode,
} from "@sdl/architecture";
import { summarizeConfig } from "../catalogUi";
import { useEditor } from "../store/editorContext";

/**
 * Text alternative to the diagram (accessibility): the same document as headings and lists, readable by
 * screen readers and easy to scan. Read-only; select a component's name to edit it in the inspector.
 */
export function OutlineView({ onSelectNode }: { onSelectNode: (id: string) => void }) {
  const doc = useEditor((s) => s.doc);
  const label = (id: string) => doc.nodes.find((n) => n.id === id)?.label ?? "a missing component";

  return (
    <div className="h-full overflow-y-auto">
      <article className="mx-auto grid max-w-3xl gap-6 p-6 text-sm" aria-label="Architecture outline">
        <section aria-labelledby="outline-ops">
          <h2 id="outline-ops" className="mb-2 text-base font-semibold">
            Operations
          </h2>
          <ul className="list-disc pl-5">
            {doc.operations.map((o) => (
              <li key={o.id}>
                {o.name} ({o.kind}, share {o.share}
                {o.share === 0 ? ", internal or message-only" : ""})
              </li>
            ))}
          </ul>
        </section>

        {doc.nodes.length === 0 && <p className="text-muted-foreground">The design has no components yet.</p>}

        {CATEGORIES.map((category) => {
          const nodes = doc.nodes.filter((n) => CATALOG[n.type].category === category.id);
          if (nodes.length === 0) return null;
          return (
            <section key={category.id} aria-labelledby={`outline-${category.id}`}>
              <h2 id={`outline-${category.id}`} className="mb-2 text-base font-semibold">
                {category.name}
              </h2>
              <ul className="grid gap-4">
                {nodes.map((node) => {
                  const outgoing = doc.edges.filter((e) => e.source === node.id);
                  const incoming = doc.edges.filter((e) => e.target === node.id);
                  const flows = Object.entries(flowsOf(node));
                  return (
                    <li key={node.id} className="rounded-md border p-3">
                      <h3 className="font-medium">
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => onSelectNode(node.id)}
                        >
                          {node.label}
                        </button>{" "}
                        <span className="font-normal text-muted-foreground">
                          — {CATALOG[node.type].name}, {summarizeConfig(node)}
                        </span>
                      </h3>
                      <p className="mt-1 text-muted-foreground">
                        {incoming.length > 0
                          ? `Receives from ${incoming.map((e) => label(e.source)).join(", ")}. `
                          : "Receives from nothing. "}
                        {outgoing.length > 0
                          ? `Connects to ${outgoing.map((e) => label(e.target)).join(", ")}.`
                          : "Connects to nothing."}
                      </p>
                      {isFlowNode(node) && (
                        <div className="mt-2">
                          {flows.length === 0 ? (
                            <p className="text-muted-foreground">
                              Has no flows, so it handles no operations.
                            </p>
                          ) : (
                            <ul className="grid gap-1">
                              {flows.map(([op, steps]) => (
                                <li key={op}>
                                  <span className="font-medium">
                                    {doc.operations.find((o) => o.id === op)?.name ?? op}:
                                  </span>{" "}
                                  {steps.length === 0 ? "no steps" : <StepsText doc={doc} steps={steps} />}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {doc.notes && (
          <section aria-labelledby="outline-notes">
            <h2 id="outline-notes" className="mb-2 text-base font-semibold">
              Notes
            </h2>
            <p className="whitespace-pre-wrap">{doc.notes}</p>
          </section>
        )}
      </article>
    </div>
  );
}

function StepsText({ doc, steps }: { doc: ArchitectureDocument; steps: FlowStep[] }) {
  const target = (edgeId: string) => {
    const edge = doc.edges.find((e) => e.id === edgeId);
    return doc.nodes.find((n) => n.id === edge?.target)?.label ?? "a missing connection";
  };
  return (
    <ol className="ml-5 list-decimal">
      {steps.map((step, i) => (
        <li key={i}>
          {step.type === "call" &&
            `call ${target(step.edge)}${step.as ? ` (${step.as})` : ""}${step.optional ? ", optional" : ""}`}
          {step.type === "publish" && `publish to ${target(step.edge)}${step.optional ? ", optional" : ""}`}
          {step.type === "cache-lookup" && (
            <>
              look up in {target(step.edge)}
              {step.populate ? ", populate on miss" : ""}; on a miss:{" "}
              {step.onMiss.length === 0 ? "nothing" : <StepsText doc={doc} steps={step.onMiss} />}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
