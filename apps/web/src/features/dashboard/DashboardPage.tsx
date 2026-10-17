import { CircleAlert, LayoutTemplate, Trophy } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
          <EmptyState
            icon={LayoutTemplate}
            title="No saved designs"
            description="The architecture playground is coming soon. Designs you save will be listed here."
          />
        </section>
      </div>
    </div>
  );
}
