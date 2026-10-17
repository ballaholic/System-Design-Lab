import { lazy, Suspense } from "react";
import { PageSpinner } from "@/components/PageSpinner";
import { useAuth } from "@/features/auth/authContext";
import { LandingPage } from "@/features/dashboard/LandingPage";

// The dashboard brings in challenge content and the evaluator; guests on the landing page don't need them.
const DashboardPage = lazy(async () => ({
  default: (await import("@/features/dashboard/DashboardPage")).DashboardPage,
}));

export function HomePage() {
  const { status } = useAuth();
  if (status === "loading") return <PageSpinner label="Loading" />;
  if (status !== "authenticated") return <LandingPage />;
  return (
    <Suspense fallback={<PageSpinner label="Loading your dashboard" />}>
      <DashboardPage />
    </Suspense>
  );
}
