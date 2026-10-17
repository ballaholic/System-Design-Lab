import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { appUrl, authErrorMessage } from "@/features/auth/authUtils";
import { supabase } from "@/lib/supabase";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.3-4.7 3.3-7.9Z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23Z"
      />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 9.9l3.7-2.8Z" />
      <path
        fill="#EA4335"
        d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4Z"
      />
    </svg>
  );
}

/** Redirects to Google via Supabase; the provider must be enabled in the Supabase dashboard. */
export function GoogleSignInButton({ next }: { next: string }) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: appUrl(`/auth/callback?next=${encodeURIComponent(next)}`) },
    });
    if (error) {
      setPending(false);
      toast.error(authErrorMessage(error));
    }
    // On success the browser navigates away.
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={pending}
      onClick={() => void signIn()}
    >
      <GoogleMark />
      Continue with Google
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
