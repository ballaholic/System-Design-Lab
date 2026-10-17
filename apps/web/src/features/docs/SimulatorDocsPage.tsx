import { CATALOG } from "@sdl/architecture";
import {
  ASSUMPTIONS,
  ENGINE_VERSION,
  EVENT_DESCRIPTIONS,
  FAILURE_KINDS,
  FAILURES,
  OUTCOME_DESCRIPTIONS,
  ROLE_SEMANTICS,
  type SimEventKind,
  STATUS_DESCRIPTIONS,
  TARGET_UTILIZATION,
} from "@sdl/simulation";
import type { ReactNode } from "react";
import { STATUS_UI } from "@/features/playground/simulation/simulationUi";
import { cn } from "@/lib/utils";

const EVENT_LABELS: Record<SimEventKind, string> = {
  saturated: "Saturated",
  "rate-limited": "Rate-limited",
  down: "Down",
  unroutable: "Unroutable",
  "backlog-growing": "Backlog growing",
  idle: "Idle",
  unmodeled: "Not modeled",
};

/**
 * "How the simulator works" (PRD §7.3, ARCHITECTURE §6.9). Generated from the engine's registries, so it
 * describes exactly what the engine does. Public: guests can read it too.
 */
export function SimulatorDocsPage() {
  return (
    <article className="mx-auto grid max-w-3xl gap-10 pb-12">
      <header className="grid gap-2">
        <p className="text-xs text-muted-foreground">Simulation engine v{ENGINE_VERSION}</p>
        <h1 className="text-3xl font-semibold tracking-tight">How the simulator works</h1>
        <p className="text-muted-foreground">
          The simulator is a teaching model, not a capacity planner. It computes steady-state request rates
          from your design: what each component is offered, what it admits, and what succeeds. It is
          deterministic: the same design, traffic and failures always give the same result. It runs entirely
          in your browser.
        </p>
        <nav aria-label="On this page" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {[
            ["model", "The model"],
            ["components", "Components"],
            ["outcomes", "Outcomes"],
            ["failures", "Failures"],
            ["statuses", "Statuses and events"],
            ["assumptions", "Assumptions"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="underline underline-offset-2 hover:text-foreground">
              {label}
            </a>
          ))}
        </nav>
      </header>

      <Section id="model" title="The model">
        <p>
          <strong>Operations</strong> are the kinds of requests users make, such as &ldquo;Follow short
          link&rdquo; (a read) or &ldquo;Create short link&rdquo; (a write). The total traffic is split
          between operations by their shares, and between clients by each client&apos;s traffic share.
        </p>
        <p>
          <strong>Flows</strong> say what an API server or background worker does for each operation, as a
          list of steps:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <strong>Call</strong>: a synchronous call over a connection. Optional calls don&apos;t fail the
            request.
          </li>
          <li>
            <strong>Cache lookup</strong>: hits finish the step; misses run the on-miss steps. With populate
            on, each miss also fills the cache.
          </li>
          <li>
            <strong>Publish</strong>: hands a message to a queue or stream. The request only waits for the
            broker to accept it.
          </li>
        </ul>
        <p>
          Load balancers, gateways, clients and CDN misses split traffic evenly across the connected
          components that can handle each operation. A connection carries traffic only if routing or a flow
          step uses it.
        </p>
        <p>
          When load exceeds capacity, the excess is rejected (load shedding). Below saturation everything
          scales linearly, so the <strong>breaking point</strong> (the traffic at which the first component
          saturates) is exact. <strong>Instances needed</strong> is the number of instances that keeps a
          server or worker at or below {Math.round(TARGET_UTILIZATION * 100)}% utilization.
        </p>
      </Section>

      <Section id="components" title="Components">
        <div className="grid gap-4">
          {ROLE_SEMANTICS.map((role) => (
            <section key={role.role} className="rounded-lg border p-4" aria-labelledby={`role-${role.role}`}>
              <h3 id={`role-${role.role}`} className="font-medium">
                {role.title}
              </h3>
              <p className="text-xs text-muted-foreground">
                {role.types.map((t) => CATALOG[t].name).join(", ")}
              </p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
                <dt className="text-muted-foreground">Capacity</dt>
                <dd>{role.capacity}</dd>
                <dt className="text-muted-foreground">Behaviour</dt>
                <dd>{role.behaviour}</dd>
                <dt className="text-muted-foreground">Success</dt>
                <dd>{role.success}</dd>
                <dt className="text-muted-foreground">Not modeled</dt>
                <dd>{role.notModeled.join(", ")}.</dd>
              </dl>
            </section>
          ))}
        </div>
      </Section>

      <Section id="outcomes" title="Outcomes">
        <p>The simulator keeps four outcomes apart for each operation:</p>
        <dl className="grid gap-2">
          {OUTCOME_DESCRIPTIONS.map((o) => (
            <div key={o.term}>
              <dt className="font-medium">{o.term}</dt>
              <dd className="text-muted-foreground">{o.description}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="failures" title="Failures">
        <p>
          You can inject failures into components to see their blast radius. Several failures can be combined.
          They apply to the simulation only and aren&apos;t saved with the design.
        </p>
        <dl className="grid gap-2">
          {FAILURE_KINDS.map((kind) => (
            <div key={kind}>
              <dt className="font-medium">
                {FAILURES[kind].label}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({FAILURES[kind].appliesTo.map((t) => CATALOG[t].name).join(", ")})
                </span>
              </dt>
              <dd className="text-muted-foreground">{FAILURES[kind].description}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="statuses" title="Statuses and events">
        <ul className="grid gap-1.5">
          {(Object.keys(STATUS_DESCRIPTIONS) as Array<keyof typeof STATUS_DESCRIPTIONS>).map((status) => {
            const ui = STATUS_UI[status];
            const Icon = ui.icon;
            return (
              <li key={status} className="flex items-start gap-2">
                <span className={cn("flex w-28 shrink-0 items-center gap-1.5 font-medium", ui.text)}>
                  <Icon className="size-4" aria-hidden />
                  {ui.label}
                </span>
                <span className="text-muted-foreground">{ui.description}</span>
              </li>
            );
          })}
        </ul>
        <dl className="grid gap-1.5">
          {(Object.keys(EVENT_DESCRIPTIONS) as SimEventKind[]).map((kind) => (
            <div key={kind} className="flex gap-2">
              <dt className="w-36 shrink-0 font-medium">{EVENT_LABELS[kind]}</dt>
              <dd className="text-muted-foreground">{EVENT_DESCRIPTIONS[kind]}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="assumptions" title="Assumptions">
        <p>Every result is computed under these assumptions:</p>
        <dl className="grid gap-2">
          {ASSUMPTIONS.map((a) => (
            <div key={a.id} id={a.id}>
              <dt className="font-medium">
                {a.title} <span className="font-mono text-xs font-normal text-muted-foreground">{a.id}</span>
              </dt>
              <dd className="text-muted-foreground">{a.text}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </article>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-20 gap-3 leading-relaxed">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}
