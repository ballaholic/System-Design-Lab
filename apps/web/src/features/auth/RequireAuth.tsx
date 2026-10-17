import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { PageSpinner } from "@/components/PageSpinner";
import { useAuth } from "@/features/auth/authContext";

/** Renders children for signed-in users; otherwise redirects to /login and comes back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <PageSpinner label="Checking your session" />;
  if (status === "anonymous") {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}
