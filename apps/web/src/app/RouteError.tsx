import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Button } from "@/components/ui/button";

/** Route-level error boundary: an unexpected render/loader error never leaves a blank page. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const detail = import.meta.env.DEV && error instanceof Error ? error.message : null;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-start justify-center gap-4 px-4">
      <p className="font-mono text-sm text-muted-foreground">{notFound ? "404" : "Error"}</p>
      <h1 className="text-2xl font-semibold tracking-tight">
        {notFound ? "Page not found" : "Something went wrong"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {notFound
          ? "The page you're looking for doesn't exist."
          : "An unexpected error occurred. Reloading usually helps; your session is unaffected."}
      </p>
      {detail && <pre className="w-full overflow-auto rounded-md bg-muted p-3 text-xs">{detail}</pre>}
      <div className="flex gap-2">
        <Button asChild>
          <Link to="/">Go home</Link>
        </Button>
        {!notFound && (
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        )}
      </div>
    </div>
  );
}
