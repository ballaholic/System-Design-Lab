import type { ArchitectureDocument } from "@sdl/architecture";
import type { MentorSimulation } from "@sdl/simulation";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/authContext";
import { ApiError, apiFetch, parseProblem, type ProblemDetails } from "@/lib/api/client";
import { getEnv } from "@/lib/env";
import { supabase } from "@/lib/supabase";

export type MentorMode = "tutor" | "interviewer" | "reviewer";
export type InterviewStep = "requirements" | "estimation" | "high-level-design" | "deep-dive";

export const INTERVIEW_STEPS: readonly { id: InterviewStep; label: string }[] = [
  { id: "requirements", label: "Requirements" },
  { id: "estimation", label: "Estimation" },
  { id: "high-level-design", label: "High-level design" },
  { id: "deep-dive", label: "Deep dive" },
];

export interface Conversation {
  id: string;
  mode: MentorMode;
  title: string;
  architectureId: string | null;
  attemptId: string | null;
  metadata: { step?: InterviewStep };
  createdAt: string;
  updatedAt: string;
}

export type Level = "high" | "medium" | "low";

export interface ReviewFinding {
  id: string;
  category: "capacity" | "availability" | "data-flow" | "requirements" | "simplicity" | "other";
  severity: Level;
  confidence: Level;
  nodeIds: string[];
  title: string;
  explanation: string;
  suggestion: string;
}

export interface MentorMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  review?: { summary: string; findings: ReviewFinding[] } | null;
  status: "complete" | "error" | "truncated";
  createdAt: string;
}

export interface Quota {
  available: boolean;
  emailVerified: boolean;
  remainingPercent: number;
  resetsAt: string;
}

/** What a message is sent with (ARCHITECTURE §8.1): the current design and its latest valid simulation. */
export interface MentorContext {
  architecture: ArchitectureDocument;
  simulation: MentorSimulation | null;
}

export const mentorKeys = {
  quota: (userId: string | undefined) => ["mentor", userId, "quota"] as const,
  list: (userId: string | undefined, filter: Record<string, string | undefined>) =>
    ["mentor", userId, "conversations", filter] as const,
  conversation: (userId: string | undefined, id: string) => ["mentor", userId, "conversation", id] as const,
};

export const mentorApi = {
  quota: () => apiFetch<Quota>("/api/mentor/quota"),
  list: (filter: { mode?: MentorMode; architectureId?: string; attemptId?: string }) => {
    const params = new URLSearchParams(
      Object.entries(filter).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
    return apiFetch<{ items: Conversation[] }>(`/api/mentor/conversations?${params}`);
  },
  create: (input: { mode: MentorMode; architectureId?: string | null; attemptId?: string | null }) =>
    apiFetch<{ conversation: Conversation; messages: MentorMessage[] }>("/api/mentor/conversations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  get: (id: string) =>
    apiFetch<{ conversation: Conversation; messages: MentorMessage[] }>(`/api/mentor/conversations/${id}`),
  update: (id: string, patch: { title?: string; step?: InterviewStep }) =>
    apiFetch<Conversation>(`/api/mentor/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};

export interface StreamHandlers {
  onDelta(text: string): void;
  onDone(message: MentorMessage, remainingPercent: number): void;
  /** A failure after the answer started; failures before it throw an ApiError instead. */
  onError(problem: ProblemDetails): void;
}

/**
 * Sends a message and reads the server-sent events of the answer. EventSource can't POST or send headers, so this
 * reads the response body directly.
 */
export async function sendMessage(
  conversationId: string,
  content: string,
  context: MentorContext,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers({ "Content-Type": "application/json", Accept: "text/event-stream" });
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);

  let response: Response;
  try {
    response = await fetch(`${getEnv().apiBaseUrl}/api/mentor/conversations/${conversationId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content, ...context }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) return;
    throw new ApiError(0, {
      title: "Network error",
      detail: e instanceof Error ? "The server could not be reached. Check your connection." : undefined,
    });
  }
  if (!response.ok || !response.body) throw new ApiError(response.status, await parseProblem(response));

  await readEvents(response.body, (event, payload) => {
    if (event === "delta") handlers.onDelta((payload as { text: string }).text);
    else if (event === "done") {
      const done = payload as { message: MentorMessage; remainingPercent: number };
      handlers.onDone(done.message, done.remainingPercent);
    } else if (event === "error") handlers.onError(payload as ProblemDetails);
  });
}

/** Parses `event:` / `data:` blocks separated by blank lines. */
export async function readEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, payload: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length > 0) onEvent(event, JSON.parse(data.join("\n")));
      boundary = buffer.indexOf("\n\n");
    }
    if (done) return;
  }
}

export function useMentorQuota() {
  const { status, session } = useAuth();
  return useQuery({
    queryKey: mentorKeys.quota(session?.user.id),
    queryFn: mentorApi.quota,
    enabled: status === "authenticated",
    staleTime: 30_000,
  });
}
