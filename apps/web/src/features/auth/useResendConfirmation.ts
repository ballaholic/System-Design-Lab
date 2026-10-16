import { useEffect, useState } from "react";
import { toast } from "sonner";
import { appUrl, authErrorMessage } from "@/features/auth/authUtils";
import { supabase } from "@/lib/supabase";

const COOLDOWN_SECONDS = 60;

/** Resends the sign-up confirmation email, with a client-side cooldown matching Supabase's rate limit. */
export function useResendConfirmation(email: string) {
  const [cooldown, setCooldown] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    setPending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: appUrl("/auth/callback") },
    });
    setPending(false);
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    toast.success("Confirmation email sent");
    setCooldown(COOLDOWN_SECONDS);
  }

  return { resend, pending, cooldown, disabled: pending || cooldown > 0 };
}
