import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/authContext";
import { architecturesKey } from "@/lib/api/architectures";
import { attemptsKey } from "@/lib/api/attempts";
import { errorMessage } from "@/lib/api/client";
import { importGuestDesigns } from "./guestImport";

/** After sign-in, moves designs made as a guest in this browser into the account (AUTH-9). */
export function GuestImporter() {
  const { status, session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  useEffect(() => {
    if (status !== "authenticated") return;
    importGuestDesigns()
      .then((result) => {
        if (!result) return;
        if (result.imported > 0 || result.attempts > 0) {
          const designs = `${result.imported} design${result.imported === 1 ? "" : "s"}`;
          toast.success(
            result.attempts > 0
              ? `Moved ${designs} and your challenge progress from this browser to your account.`
              : `Moved ${designs} from this browser to your account.`,
          );
          void queryClient.invalidateQueries({ queryKey: architecturesKey(userId) });
          void queryClient.invalidateQueries({ queryKey: attemptsKey(userId) });
        }
        if (result.skipped > 0) {
          toast.warning(
            `${result.skipped} design${result.skipped === 1 ? "" : "s"} in this browser couldn't be imported.`,
          );
        }
      })
      .catch((e: unknown) =>
        toast.error("Couldn't import your guest designs", { description: errorMessage(e) }),
      );
  }, [status, userId, queryClient]);

  return null;
}
