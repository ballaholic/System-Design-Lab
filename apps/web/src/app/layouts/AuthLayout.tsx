import { Outlet } from "react-router";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AuthLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between px-4">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-[8vh]">
        <div className="w-full max-w-sm">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
