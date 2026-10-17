import { Link, NavLink, Outlet } from "react-router";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/features/auth/authContext";
import { cn } from "@/lib/utils";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-md px-2.5 py-1.5 text-sm transition-colors",
    isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
  );

/** Sections that exist in the plan but are not built yet: shown, clearly not interactive. */
function UpcomingNavItem({ label }: { label: string }) {
  return (
    <span
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-muted-foreground/60"
      aria-disabled="true"
    >
      {label}
      <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
        Soon
      </Badge>
    </span>
  );
}

export function AppShell() {
  const { status } = useAuth();

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            <NavLink to="/" end className={navLinkClass}>
              {status === "authenticated" ? "Dashboard" : "Home"}
            </NavLink>
            <UpcomingNavItem label="Playground" />
            <UpcomingNavItem label="Challenges" />
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            {status === "authenticated" && <UserMenu />}
            {status === "anonymous" && (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/register">Create account</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
