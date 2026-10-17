import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/authContext";
import { type Attempt, type AttemptPatch, attemptsApi, attemptsKey } from "@/lib/api/attempts";
import { errorMessage } from "@/lib/api/client";
import { isGuestAttemptId, updateGuestAttempt } from "../attempts/guestAttempts";

/**
 * The attempt being played, updated optimistically. Guest attempts save to this browser at once; account
 * attempts are sent in order, so a slow request can't overwrite a newer change.
 */
export function useAttemptState(initial: Attempt) {
  const [attempt, setAttempt] = useState(initial);
  const current = useRef(initial);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;

  /** Takes a function of the latest attempt, so quick successive changes build on each other. */
  const update = useCallback(
    (change: (attempt: Attempt) => AttemptPatch) => {
      const patch = change(current.current);
      const at = new Date().toISOString();
      const next: Attempt = {
        ...current.current,
        ...patch,
        lastActivityAt: at,
        ...(patch.status === "completed" ? { completedAt: at } : {}),
      };
      current.current = next;
      setAttempt(next);
      if (isGuestAttemptId(next.id)) {
        updateGuestAttempt(next.id, patch);
        return;
      }
      queue.current = queue.current
        .then(() => attemptsApi.update(next.id, patch))
        .then(() => queryClient.invalidateQueries({ queryKey: attemptsKey(userId) }))
        .catch((e: unknown) => toast.error("Couldn't save your progress", { description: errorMessage(e) }));
    },
    [queryClient, userId],
  );

  return { attempt, update };
}
