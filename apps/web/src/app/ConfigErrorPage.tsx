export function ConfigErrorPage({ problems }: { problems: string[] }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">Configuration required</h1>
      <p className="text-sm text-muted-foreground">
        The web app is missing environment variables. Copy{" "}
        <code className="font-mono">apps/web/.env.example</code> to{" "}
        <code className="font-mono">apps/web/.env.local</code>, fill in your Supabase project values, and
        restart the dev server.
      </p>
      <ul className="list-disc space-y-1 pl-5 font-mono text-xs text-destructive">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </main>
  );
}
