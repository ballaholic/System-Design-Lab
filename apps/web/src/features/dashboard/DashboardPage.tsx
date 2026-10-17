import { CircleAlert, LayoutTemplate, Trophy } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useArchitectureList } from "@/lib/api/architectures";
import { errorMessage } from "@/lib/api/client";
import { useMe } from "@/lib/api/me";

export function DashboardPage() {
  const { data: me, isPending, error, refetch } = useMe();

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        {isPending ? (
          <Skeleton className="h-8 w-64" />
        ) : (
          <h1 className="text-2xl font-semibold tracking-tight">
            {me ? `Welcome, ${me.displayName}` : "Welcome"}
          </h1>
        )}
        <p className="text-sm text-muted-foreground">Your learning overview.</p>
      </header>

      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Couldn't load your profile</AlertTitle>
          <AlertDescription>
            {errorMessage(error)}
            <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => void refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Real empty states: there is genuinely nothing yet, and nothing here is fabricated. */}
      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="progress-heading" className="grid gap-3">
          <h2 id="progress-heading" className="text-sm font-medium">
            Challenge progress
          </h2>
          <EmptyState
            icon={Trophy}
            title="No challenges started"
            description="Challenges, starting with the URL Shortener, are coming soon. Your progress will appear here."
          />
        </section>
        <section aria-labelledby="designs-heading" className="grid gap-3">
          <h2 id="designs-heading" className="text-sm font-medium">
            Recent designs
          </h2>
          <RecentDesigns />
        </section>
      </div>
    </div>
  );
}

function RecentDesigns() {
  const { data, isPending, error } = useArchitectureList();
  if (isPending) return <Skeleton className="h-32" />;
  if (error)
    return <p className="text-sm text-muted-foreground">Couldn't load your designs: {errorMessage(error)}</p>;
  if (data.length === 0) {
    return (
      <EmptyState
        icon={LayoutTemplate}
        title="No saved designs"
        description="Designs you build in the playground are saved here automatically."
        action={
          <Button size="sm" asChild>
            <Link to="/playground">Open the playground</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="grid gap-2">
      <ul className="divide-y rounded-lg border">
        {data.slice(0, 5).map((d) => (
          <li key={d.id}>
            <Link
              to={`/playground/${d.id}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-accent"
            >
              <span className="truncate font-medium">{d.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {d.nodeCount} component{d.nodeCount === 1 ? "" : "s"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/designs" className="w-fit text-sm text-muted-foreground underline-offset-2 hover:underline">
        All designs
      </Link>
    </div>
  );
}
