import type { CriterionResult, ExerciseAnswers } from "@sdl/challenges";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/authContext";
import { apiFetch } from "@/lib/api/client";

export type AttemptStatus = "in_progress" | "completed" | "abandoned";

export interface StageResult {
  passedAt?: string;
  criteria: CriterionResult[];
  engineVersion: string;
}

/** A challenge attempt (DATA_MODEL §4.2). Guest attempts have the same shape, stored in this browser. */
export interface Attempt {
  id: string;
  challengeSlug: string;
  challengeVersion: number;
  mode: "guided";
  status: AttemptStatus;
  currentStageId: string;
  architectureId: string | null;
  stageResults: Record<string, StageResult>;
  exerciseAnswers: ExerciseAnswers;
  hintsRevealed: string[];
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
}

export type AttemptPatch = Partial<
  Pick<Attempt, "currentStageId" | "stageResults" | "exerciseAnswers" | "hintsRevealed" | "architectureId">
> & { status?: "completed" | "abandoned" };

export const attemptsKey = (userId: string | undefined) => ["attempts", userId] as const;

export const attemptsApi = {
  list: () => apiFetch<{ items: Attempt[] }>("/api/attempts"),
  get: (id: string) => apiFetch<Attempt>(`/api/attempts/${id}`),
  /** 409 with `attemptId` when one is in progress and `restart` isn't set. */
  create: (input: { challengeSlug: string; architectureId: string; restart?: boolean }) =>
    apiFetch<Attempt>("/api/attempts", {
      method: "POST",
      body: JSON.stringify({ ...input, mode: "guided" }),
    }),
  update: (id: string, patch: AttemptPatch) =>
    apiFetch<Attempt>(`/api/attempts/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
};

export function useServerAttempts() {
  const { status, session } = useAuth();
  return useQuery({
    queryKey: [...attemptsKey(session?.user.id), "list"],
    queryFn: async () => (await attemptsApi.list()).items,
    enabled: status === "authenticated",
  });
}
