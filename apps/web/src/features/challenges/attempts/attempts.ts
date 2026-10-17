import { type ArchitectureDocument, createEmptyDocument } from "@sdl/architecture";
import type { Challenge } from "@sdl/challenges";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useAuth } from "@/features/auth/authContext";
import { newGuestId, saveGuestDesign } from "@/features/playground/persistence/guestDesigns";
import { architecturesApi, architecturesKey } from "@/lib/api/architectures";
import { type Attempt, attemptsApi, attemptsKey, useServerAttempts } from "@/lib/api/attempts";
import { ApiError } from "@/lib/api/client";
import { createGuestAttempt, listGuestAttempts } from "./guestAttempts";

/** The design a new attempt starts from: the challenge's starter, at the first stage's traffic. */
export function starterDocument(challenge: Challenge): ArchitectureDocument {
  const doc = structuredClone(challenge.starter ?? createEmptyDocument());
  return { ...doc, traffic: challenge.stages[0]!.traffic };
}

/** The attempts of whoever is using the app: this browser's for guests, the account's when signed in. */
export function useAttempts(): { attempts: Attempt[]; isPending: boolean; error: unknown; refresh(): void } {
  const { status } = useAuth();
  const server = useServerAttempts();
  const [guest, setGuest] = useState(listGuestAttempts);
  const refreshGuest = useCallback(() => setGuest(listGuestAttempts()), []);
  if (status === "authenticated") {
    return {
      attempts: server.data ?? [],
      isPending: server.isPending,
      error: server.error,
      refresh: () => void server.refetch(),
    };
  }
  return { attempts: guest, isPending: status === "loading", error: null, refresh: refreshGuest };
}

/** The attempt to show for a challenge: the one in progress, else the latest completed one. */
export function currentAttempt(attempts: readonly Attempt[], slug: string): Attempt | undefined {
  const mine = attempts.filter((a) => a.challengeSlug === slug);
  return mine.find((a) => a.status === "in_progress") ?? mine.find((a) => a.status === "completed");
}

export function stageNumber(challenge: Challenge, attempt: Attempt): number {
  return (
    Math.max(
      0,
      challenge.stages.findIndex((s) => s.id === attempt.currentStageId),
    ) + 1
  );
}

export type StartResult = { ok: true; attempt: Attempt } | { ok: false; inProgress: Attempt | null };

/**
 * Starts an attempt with a fresh design from the starter. Without `restart`, an attempt already in progress
 * isn't replaced: the caller asks the user, then calls again with `restart` to abandon it.
 */
export function useStartAttempt() {
  const { status, session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  return useCallback(
    async (challenge: Challenge, restart = false, mode: Attempt["mode"] = "guided"): Promise<StartResult> => {
      const document = starterDocument(challenge);
      if (status !== "authenticated") {
        if (mode === "interview") throw new Error("Interview mode needs an account with a verified email.");
        const existing = listGuestAttempts().find(
          (a) => a.challengeSlug === challenge.slug && a.status === "in_progress",
        );
        if (existing && !restart) return { ok: false, inProgress: existing };
        const designId = newGuestId();
        const saved = saveGuestDesign(designId, challenge.title, document, challenge.slug);
        if (!saved.ok) {
          throw new Error(
            saved.reason === "limit"
              ? "This browser already holds 10 guest designs. Delete one in My designs, or sign in."
              : "This browser's storage is unavailable, so progress can't be saved. Try signing in.",
          );
        }
        return { ok: true, attempt: createGuestAttempt(challenge, designId) };
      }

      const architecture = await architecturesApi.create({
        title: challenge.title,
        document,
        challengeSlug: challenge.slug,
      });
      try {
        const attempt = await attemptsApi.create({
          challengeSlug: challenge.slug,
          architectureId: architecture.id,
          restart,
          mode,
        });
        void queryClient.invalidateQueries({ queryKey: attemptsKey(userId) });
        void queryClient.invalidateQueries({ queryKey: architecturesKey(userId) });
        return { ok: true, attempt };
      } catch (e) {
        // Another tab started one meanwhile: don't leave an orphan design behind.
        void architecturesApi.remove(architecture.id).catch(() => undefined);
        if (e instanceof ApiError && e.status === 409) {
          const attemptId = (e.problem as { attemptId?: string }).attemptId;
          const inProgress = attemptId ? await attemptsApi.get(attemptId).catch(() => null) : null;
          return { ok: false, inProgress };
        }
        throw e;
      }
    },
    [status, queryClient, userId],
  );
}

export const attemptPath = (slug: string, attemptId: string) => `/challenges/${slug}/attempt/${attemptId}`;
