import { PageSpinner } from "@/components/PageSpinner";
import { useAuth } from "@/features/auth/authContext";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { LandingPage } from "@/features/dashboard/LandingPage";

export function HomePage() {
  const { status } = useAuth();
  if (status === "loading") return <PageSpinner label="Loading" />;
  return status === "authenticated" ? <DashboardPage /> : <LandingPage />;
}
