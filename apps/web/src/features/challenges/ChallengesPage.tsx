import { Trophy } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { currentAttempt, useAttempts } from "./attempts/attempts";
import { ChallengeStatus } from "./ChallengeStatus";
import { CHALLENGES, DIFFICULTY_LABEL, topicLabel } from "./content";

const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;

/** Challenge library (CH-2): filters by difficulty and topic, with each challenge's status for this user. */
export function ChallengesPage() {
  const { attempts } = useAttempts();
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const topics = [...new Set(CHALLENGES.flatMap((c) => c.topics))].sort();
  const shown = CHALLENGES.filter(
    (c) => (!difficulty || c.difficulty === difficulty) && (!topic || c.topics.includes(topic)),
  );

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Challenges</h1>
        <p className="text-sm text-muted-foreground">
          Design a real system stage by stage. Each stage raises the stakes, and the simulator checks your
          design.
        </p>
      </header>

      <div className="grid gap-2">
        <FilterGroup
          label="Difficulty"
          options={DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))}
          value={difficulty}
          onChange={setDifficulty}
        />
        <FilterGroup
          label="Topic"
          options={topics.map((t) => ({ value: t, label: topicLabel(t) }))}
          value={topic}
          onChange={setTopic}
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No challenges match"
          description="Try another difficulty or topic."
          action={
            <button
              type="button"
              className="text-sm underline underline-offset-2"
              onClick={() => {
                setDifficulty(null);
                setTopic(null);
              }}
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <li key={c.slug}>
              <Link
                to={`/challenges/${c.slug}`}
                className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{c.title}</h2>
                  <Badge variant="secondary">{DIFFICULTY_LABEL[c.difficulty]}</Badge>
                </div>
                <p className="flex-1 text-sm text-muted-foreground">{c.summary}</p>
                <div className="flex flex-wrap gap-1">
                  {c.topics.map((t) => (
                    <Badge key={t} variant="outline" className="font-normal">
                      {topicLabel(t)}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 border-t pt-3">
                  <ChallengeStatus challenge={c} attempt={currentAttempt(attempts, c.slug)} />
                  <span className="text-xs text-muted-foreground">{c.stages.length} stages</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">More challenges are on the way.</p>
    </div>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string | null;
  onChange(value: string | null): void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 text-xs text-muted-foreground">{label}</span>
      {[{ value: null, label: "All" }, ...options].map((o) => (
        <button
          key={o.value ?? "all"}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-full border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
