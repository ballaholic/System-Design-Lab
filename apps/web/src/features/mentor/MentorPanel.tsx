import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  ChevronRight,
  CircleAlert,
  Info,
  LoaderCircle,
  Lock,
  MailCheck,
  Send,
  Sparkles,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useId, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/authContext";
import { ApiError, errorMessage, type ProblemDetails } from "@/lib/api/client";
import {
  type Conversation,
  INTERVIEW_STEPS,
  mentorApi,
  mentorKeys,
  type MentorMessage,
  type MentorMode,
  type Quota,
  sendMessage,
  useMentorQuota,
} from "@/lib/api/mentor";
import { cn } from "@/lib/utils";
import { useEditor, useEditorStore } from "../playground/store/editorContext";
import { FindingCard } from "./FindingCard";
import { buildMentorContext } from "./mentorContext";

/** What a mentor conversation is linked to (DATA_MODEL §4.2). */
export interface MentorLink {
  /** The saved design, if there is one. */
  architectureId: string | null;
  attemptId: string | null;
  /** A challenge in Interview mode: the Interviewer replaces the Tutor. */
  interview: boolean;
}

const MODE_LABEL: Record<MentorMode, string> = {
  tutor: "Tutor",
  interviewer: "Interviewer",
  reviewer: "Reviewer",
};
const MODE_HINT: Record<MentorMode, string> = {
  tutor: "Ask about concepts, your design or its simulation results.",
  interviewer: "A mock interview: requirements, estimation, high-level design, then a deep dive.",
  reviewer: "Get structured feedback on the design as it is now.",
};

/** The Mentor inspector tab (PRD AI-1…AI-8). Guests and unverified users see what they need to do first. */
export function MentorPanel({ link }: { link: MentorLink }) {
  const { status } = useAuth();
  if (status === "loading")
    return (
      <Centered>
        <LoaderCircle className="size-4 animate-spin" aria-label="Loading" />
      </Centered>
    );
  if (status !== "authenticated") return <SignInPrompt />;
  return <SignedInMentor link={link} />;
}

function SignInPrompt() {
  const location = useLocation();
  const next = encodeURIComponent(location.pathname);
  return (
    <Notice icon={Lock} title="The AI mentor needs an account">
      Sign in with a verified email to ask the Tutor, run a design review or practise an interview. Your
      design is kept and moves to your account.
      <div className="mt-3 flex gap-2">
        <Button size="sm" asChild>
          <Link to={`/login?next=${next}`}>Sign in</Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link to="/register">Create account</Link>
        </Button>
      </div>
    </Notice>
  );
}

function SignedInMentor({ link }: { link: MentorLink }) {
  const quota = useMentorQuota();
  if (quota.isPending)
    return (
      <Centered>
        <LoaderCircle className="size-4 animate-spin" aria-label="Loading" />
      </Centered>
    );
  if (quota.error)
    return (
      <Notice icon={CircleAlert} title="The mentor couldn't be loaded">
        {errorMessage(quota.error)}
      </Notice>
    );
  if (!quota.data.emailVerified) {
    return (
      <Notice icon={MailCheck} title="Verify your email to use the AI mentor">
        Open the link in the confirmation email we sent, then sign out and sign in again.
      </Notice>
    );
  }
  if (!quota.data.available) {
    return (
      <Notice icon={Info} title="The AI mentor is turned off right now">
        Everything else keeps working. Try again later.
      </Notice>
    );
  }
  return <Mentor link={link} quota={quota.data} />;
}

function Mentor({ link, quota }: { link: MentorLink; quota: Quota }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const modes: MentorMode[] = link.interview ? ["interviewer", "reviewer"] : ["tutor", "reviewer"];
  const [mode, setMode] = useState<MentorMode>(modes[0]!);
  // Undefined: the most recent conversation for this mode and design. Null: a new one.
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  // Changes when the learner picks another mode or conversation, not when a first message creates one, so a
  // streaming answer isn't lost to a remount.
  const [view, setView] = useState(0);
  const choose = (next: string | null | undefined) => {
    setSelected(next);
    setView((v) => v + 1);
  };
  const filter = link.attemptId
    ? { mode, attemptId: link.attemptId }
    : link.architectureId
      ? { mode, architectureId: link.architectureId }
      : { mode };
  const conversations = useQuery({
    queryKey: mentorKeys.list(userId, filter),
    queryFn: async () => (await mentorApi.list(filter)).items,
  });
  const latest = conversations.data?.[0]?.id ?? null;
  const activeId = selected === undefined ? latest : selected;
  const historyId = useId();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid gap-2 border-b p-3">
        <div
          role="radiogroup"
          aria-label="Mentor mode"
          className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1"
        >
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m);
                choose(undefined);
              }}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === m ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{MODE_HINT[mode]}</p>
        {(conversations.data?.length ?? 0) > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor={historyId} className="shrink-0 text-xs text-muted-foreground">
              {mode === "reviewer" ? "Reviews" : "Conversation"}
            </label>
            <Select value={activeId ?? "new"} onValueChange={(v) => choose(v === "new" ? null : v)}>
              <SelectTrigger id={historyId} size="sm" className="h-7 min-w-0 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new" className="text-xs">
                  {mode === "reviewer" ? "New review" : "New conversation"}
                </SelectItem>
                {conversations.data!.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.title} · {new Date(c.updatedAt).toLocaleDateString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {conversations.isPending ? (
        <Centered>
          <LoaderCircle className="size-4 animate-spin" aria-label="Loading conversations" />
        </Centered>
      ) : (
        <ConversationView
          key={`${mode}:${view}`}
          conversationId={activeId}
          mode={mode}
          link={link}
          quota={quota}
          onCreated={(id) => setSelected(id)}
        />
      )}
    </div>
  );
}

function ConversationView({
  conversationId,
  mode,
  link,
  quota,
  onCreated,
}: {
  conversationId: string | null;
  mode: MentorMode;
  link: MentorLink;
  quota: Quota;
  onCreated(id: string): void;
}) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const scenario = useEditor((s) => s.scenario);
  const detail = useQuery({
    queryKey: mentorKeys.conversation(userId, conversationId ?? ""),
    queryFn: () => mentorApi.get(conversationId!),
    enabled: conversationId !== null,
  });
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ content: string; reply: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const summary = useMemo(() => buildMentorContext(doc, scenario).summary, [doc, scenario]);
  const exhausted = quota.remainingPercent <= 0;
  const busy = pending !== null || starting;
  const conversation = detail.data?.conversation;
  const messages = detail.data?.messages ?? [];

  const refresh = async (id: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: mentorKeys.conversation(userId, id) }),
      queryClient.invalidateQueries({ queryKey: ["mentor", userId, "conversations"] }),
    ]);
  };

  const ensureConversation = async (): Promise<string> => {
    if (conversationId) return conversationId;
    const created = await mentorApi.create({
      mode,
      architectureId: link.architectureId,
      attemptId: link.attemptId,
    });
    queryClient.setQueryData(mentorKeys.conversation(userId, created.conversation.id), created);
    onCreated(created.conversation.id);
    return created.conversation.id;
  };

  const startInterview = async () => {
    setStarting(true);
    setProblem(null);
    try {
      const id = await ensureConversation();
      await refresh(id);
    } catch (e) {
      setProblem(friendly(e));
    } finally {
      setStarting(false);
    }
  };

  const send = async (content: string) => {
    const text = content.trim();
    if (!text || busy || exhausted) return;
    setProblem(null);
    setPending({ content: text, reply: "" });
    // Cleared at once, and put back if the message couldn't be sent.
    setDraft("");
    let id: string | null = null;
    try {
      id = await ensureConversation();
      const { doc: current, scenario: failures } = store.getState();
      await sendMessage(id, text, buildMentorContext(current, failures).context, {
        onDelta: (delta) => setPending((p) => p && { ...p, reply: p.reply + delta }),
        onDone: (_message, remainingPercent) =>
          queryClient.setQueryData<Quota>(mentorKeys.quota(userId), (q) => q && { ...q, remainingPercent }),
        onError: (p) => setProblem(friendlyProblem(p)),
      });
    } catch (e) {
      setProblem(friendly(e));
      setDraft(content);
      if (e instanceof ApiError && e.status === 429)
        void queryClient.invalidateQueries({ queryKey: mentorKeys.quota(userId) });
    } finally {
      if (id) await refresh(id);
      setPending(null);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  };

  if (conversationId && detail.isPending) {
    return (
      <Centered>
        <LoaderCircle className="size-4 animate-spin" aria-label="Loading conversation" />
      </Centered>
    );
  }

  const needsInterviewStart = mode === "interviewer" && !conversationId;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {mode === "interviewer" && conversation && (
        <InterviewSteps conversation={conversation} onChanged={() => refresh(conversation.id)} />
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
        {messages.length === 0 && !pending && !needsInterviewStart && <EmptyState mode={mode} />}
        {needsInterviewStart && (
          <div className="grid justify-items-start gap-2 text-sm">
            <p className="text-muted-foreground">
              The interviewer leads, hints stay hidden, and you build the design as you go. Opening the
              interview is free; each answer uses some of today's allowance.
            </p>
            <Button size="sm" onClick={() => void startInterview()} disabled={starting}>
              {starting ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Start the interview
            </Button>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {pending && (
          <>
            <MessageBubble
              message={{
                id: "pending",
                role: "user",
                content: pending.content,
                status: "complete",
                createdAt: "",
              }}
            />
            <div className="grid gap-1">
              <AiLabel />
              {pending.reply ? (
                <Markdown className="text-sm">{pending.reply}</Markdown>
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                  {mode === "reviewer" ? "Reviewing your design…" : "Thinking…"}
                </p>
              )}
            </div>
          </>
        )}
        {problem && (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive"
          >
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {problem}
          </p>
        )}
      </div>
      {!needsInterviewStart && (
        <form onSubmit={onSubmit} className="grid gap-2 border-t p-3">
          <ContextDisclosure summary={summary} interview={link.interview} />
          {mode === "reviewer" ? (
            <div className="grid gap-2">
              <Textarea
                aria-label="Anything to focus on? (optional)"
                placeholder="Anything to focus on? (optional)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                maxLength={4000}
                disabled={busy || exhausted}
              />
              <Button
                type="button"
                size="sm"
                disabled={busy || exhausted}
                onClick={() => void send(draft.trim() || "Review my design.")}
              >
                <Sparkles className="size-3.5" /> Review my design
              </Button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <Textarea
                aria-label="Message the mentor"
                placeholder={mode === "interviewer" ? "Answer or ask the interviewer…" : "Ask a question…"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                maxLength={4000}
                disabled={busy || exhausted}
                className="min-h-14 flex-1 resize-none text-sm"
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Send"
                disabled={busy || exhausted || !draft.trim()}
              >
                <Send className="size-4" />
              </Button>
            </div>
          )}
          <QuotaMeter quota={quota} />
        </form>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: MentorMessage }) {
  if (message.role === "user") {
    return (
      <div className="ml-6 rounded-lg bg-primary/10 px-3 py-2 text-sm whitespace-pre-wrap">
        {message.content}
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <AiLabel />
      {message.content && <Markdown className="text-sm">{message.content}</Markdown>}
      {message.status === "truncated" && (
        <p className="text-xs text-muted-foreground">
          The answer was cut short. Ask it to continue if you need more.
        </p>
      )}
      {message.status === "error" && !message.content && (
        <p className="text-xs text-muted-foreground">This answer failed. Send your message again.</p>
      )}
      {message.review && message.review.findings.length > 0 && (
        <ol aria-label="Findings" className="grid gap-2">
          {message.review.findings.map((f) => (
            <li key={f.id}>
              <FindingCard finding={f} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AiLabel() {
  return (
    <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      <Bot className="size-3.5" aria-hidden /> AI mentor · can be wrong
    </p>
  );
}

function EmptyState({ mode }: { mode: MentorMode }) {
  const examples =
    mode === "reviewer"
      ? ["The review looks at the design and its latest simulation, and links each finding to components."]
      : [
          "Why is my database saturated?",
          "What does a cache hit rate of 80% mean here?",
          "Should I add another API server?",
        ];
  return (
    <div className="grid gap-2 text-sm text-muted-foreground">
      {mode === "reviewer" ? (
        <p>{examples[0]}</p>
      ) : (
        <>
          <p>For example:</p>
          <ul className="list-disc space-y-1 pl-5">
            {examples.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** What each message carries (ARCHITECTURE §8.1), so it's never a surprise what the AI sees. */
function ContextDisclosure({
  summary,
  interview,
}: {
  summary: ReturnType<typeof buildMentorContext>["summary"];
  interview: boolean;
}) {
  const sim = summary.simulation;
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1 select-none hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
        Context included with each message
      </summary>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-6">
        <li>
          Your current design: {summary.components} component{summary.components === 1 ? "" : "s"},{" "}
          {summary.connections} connection{summary.connections === 1 ? "" : "s"}, notes and flows (unsaved
          changes included)
        </li>
        <li>
          {sim
            ? `Simulation (engine ${sim.engineVersion}): ${sim.totalRps.toLocaleString()} requests/s, ${(sim.successRate * 100).toFixed(1)}% succeed${sim.failures > 0 ? `, ${sim.failures} injected failure${sim.failures === 1 ? "" : "s"}` : ""}`
            : `No simulation: the design has ${summary.problems} problem${summary.problems === 1 ? "" : "s"} to fix first`}
        </li>
        <li>
          {interview
            ? "The challenge and the stage you're on"
            : "The challenge stage, when you're in a challenge"}
        </li>
      </ul>
    </details>
  );
}

function QuotaMeter({ quota }: { quota: Quota }) {
  const reset = new Date(quota.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (quota.remainingPercent <= 0) {
    return (
      <p role="status" className="text-xs text-destructive">
        You've used today's mentor allowance. It resets at {reset}.
      </p>
    );
  }
  return (
    <div className="grid gap-1">
      <div
        role="meter"
        aria-label="Mentor allowance left today"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={quota.remainingPercent}
        className="h-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", quota.remainingPercent < 20 ? "bg-warning" : "bg-primary/60")}
          style={{ width: `${quota.remainingPercent}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {quota.remainingPercent}% of today's mentor allowance left
      </p>
    </div>
  );
}

function InterviewSteps({
  conversation,
  onChanged,
}: {
  conversation: Conversation;
  onChanged(): Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const current = Math.max(
    0,
    INTERVIEW_STEPS.findIndex((s) => s.id === (conversation.metadata.step ?? "requirements")),
  );
  const next = INTERVIEW_STEPS[current + 1];
  const advance = async () => {
    if (!next) return;
    setSaving(true);
    try {
      await mentorApi.update(conversation.id, { step: next.id });
      await onChanged();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <ol aria-label="Interview steps" className="flex min-w-0 flex-1 gap-1">
        {INTERVIEW_STEPS.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === current ? "step" : undefined}
            title={s.label}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              i < current ? "bg-primary/50" : i === current ? "bg-primary" : "bg-muted",
            )}
          >
            <span className="sr-only">
              {s.label}
              {i === current ? " (current)" : i < current ? " (done)" : ""}
            </span>
          </li>
        ))}
      </ol>
      <span className="shrink-0 text-xs font-medium">{INTERVIEW_STEPS[current]!.label}</span>
      {next && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          onClick={() => void advance()}
          disabled={saving}
        >
          Next step
        </Button>
      )}
    </div>
  );
}

function Notice({ icon: Icon, title, children }: { icon: typeof Info; title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 p-4 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <Icon className="size-4 text-muted-foreground" aria-hidden /> {title}
      </p>
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground">{children}</div>;
}

const TYPE = "https://systemdesignlab.dev/problems/";

/** Short messages for the mentor's error responses (ARCHITECTURE §8.4: friendly, never raw errors). */
function friendlyProblem(problem: ProblemDetails): string {
  switch (problem.type) {
    case `${TYPE}rate-limited`:
      return "You're sending messages quickly. Wait a minute, then try again.";
    case `${TYPE}mentor-busy`:
      return "The mentor is still answering your previous message.";
    case `${TYPE}mentor-quota-exceeded`:
    case `${TYPE}mentor-paused`:
    case `${TYPE}mentor-unavailable`:
    case `${TYPE}email-not-verified`:
    case `${TYPE}mentor-failed`:
      return [problem.title, problem.detail].filter(Boolean).join(" ");
    default:
      return problem.detail ?? problem.title ?? "Something went wrong. Try again.";
  }
}

function friendly(error: unknown): string {
  return error instanceof ApiError ? friendlyProblem(error.problem) : errorMessage(error);
}
