import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="flex min-h-[50vh] flex-col items-start justify-center gap-4">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
      <Button asChild>
        <Link to="/">Go home</Link>
      </Button>
    </div>
  );
}
