import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Renders the small Markdown subset used by challenge content: paragraphs, "- " lists, **bold**, *italic* and
 * `code`. It builds React elements, never HTML strings, so content can't inject markup.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  const blocks = children.trim().split(/\n{2,}/);
  return (
    <div className={cn("grid gap-2", className)}>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}

const TOKEN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function inline(text: string): ReactNode {
  return text.split(TOKEN).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
