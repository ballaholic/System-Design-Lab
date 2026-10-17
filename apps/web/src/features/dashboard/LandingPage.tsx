import { Activity, MessagesSquare, Network, Trophy } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

const loop = [
  {
    icon: Network,
    title: "Design",
    text: "Build architectures on a canvas from clients, services, caches, databases and queues.",
  },
  {
    icon: Activity,
    title: "Simulate",
    text: "Push traffic and failures through your design and watch where it breaks.",
  },
  {
    icon: MessagesSquare,
    title: "Review",
    text: "Discuss trade-offs with an AI mentor that sees your design and the results.",
  },
  {
    icon: Trophy,
    title: "Improve",
    text: "Work through challenges with progressive requirements and track your progress.",
  },
];

export function LandingPage() {
  return (
    <div className="grid gap-12 py-6 md:py-12">
      <section className="grid max-w-2xl gap-5">
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          Learn system design by building systems and seeing what happens.
        </h1>
        <p className="text-muted-foreground text-pretty">
          System Design Lab is an interactive playground: design an architecture, simulate traffic and
          failures with a transparent model, and get feedback on your decisions.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/playground">Try the playground</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/register">Create a free account</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="loop-heading" className="grid gap-4">
        <h2 id="loop-heading" className="text-sm font-medium text-muted-foreground">
          The learning loop
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {loop.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="grid gap-2 rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-primary" aria-hidden />
                <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
                <h3 className="text-sm font-medium">{title}</h3>
              </div>
              <p className="text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">
          The playground works without an account; designs stay in your browser until you sign in. The
          simulator, challenges and AI mentor are being built now and will appear here as they ship.
        </p>
      </section>
    </div>
  );
}
