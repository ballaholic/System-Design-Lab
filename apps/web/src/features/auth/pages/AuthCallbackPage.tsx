import { useEffect } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { PageSpinner } from "@/components/PageSpinner";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/AuthCard";
import { useAuth } from "@/features/auth/authContext";
import { redirectError, safeNextPath } from "@/features/auth/authUtils";

/**
 * Return point for email confirmation and Google sign-in. supabase-js has already exchanged the
 * ?code= for a session by the time auth status leaves "loading".
 */
export function AuthCallbackPage() {
  const { status } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const error = redirectError(location);
  const next = safeNextPath(params.get("next"));

  useEffect(() => {
    if (status === "authenticated" && !error) {
      toast.success("You're signed in");
      navigate(next, { replace: true });
    }
  }, [status, error, next, navigate]);

  if (error) {
    return (
      <AuthCard title="We couldn't sign you in">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button asChild>
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  if (status === "anonymous") {
    // Typical cause: the confirmation link was opened in a different browser than the one used to sign up.
    return (
      <AuthCard title="Almost there">
        <p className="text-sm text-muted-foreground">
          If you just confirmed your email, it's done. Sign in to continue. If the link expired, sign in and
          we'll offer to send a new one.
        </p>
        <Button asChild>
          <Link to="/login">Sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return <PageSpinner label="Signing you in" />;
}
