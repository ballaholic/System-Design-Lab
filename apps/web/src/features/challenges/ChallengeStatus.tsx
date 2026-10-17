import type { Challenge } from "@sdl/challenges";
import { CircleCheck, CircleDashed, CirclePlay } from "lucide-react";
import type { Attempt } from "@/lib/api/attempts";
import { cn } from "@/lib/utils";
import { stageNumber } from "./attempts/attempts";

/** Per-user status of a challenge (CH-2): icon and text, never colour alone. */
export function ChallengeStatus({
  challenge,
  attempt,
}: {
  challenge: Challenge;
  attempt: Attempt | undefined;
}) {
  if (!attempt) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <CircleDashed className="size-3.5" aria-hidden /> Not started
      </span>
    );
  }
  const done = attempt.status === "completed";
  const Icon = done ? CircleCheck : CirclePlay;
  return (
    <span
      className={cn("flex items-center gap-1 text-xs font-medium", done ? "text-success" : "text-primary")}
    >
      <Icon className="size-3.5" aria-hidden />
      {done
        ? "Completed"
        : `In progress · stage ${stageNumber(challenge, attempt)} of ${challenge.stages.length}`}
    </span>
  );
}
