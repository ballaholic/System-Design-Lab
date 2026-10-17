import { getEnv } from "@/lib/env";
import { supabase } from "@/lib/supabase";

/** RFC 9457 problem details as returned by the API (ADR-017). */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  traceId?: string;
  errors?: Record<string, string[]>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(status: number, problem: ProblemDetails) {
    super(problem.detail ?? problem.title ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }

  /** Field errors keyed by camelCase property name. */
  get fieldErrors(): Record<string, string[]> {
    return this.problem.errors ?? {};
  }
}

export async function parseProblem(response: Response): Promise<ProblemDetails> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      const body = (await response.json()) as ProblemDetails;
      return { status: response.status, ...body };
    } catch {
      // Fall through to a generic problem.
    }
  }
  return { status: response.status, title: response.statusText || "Request failed" };
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);

  let response: Response;
  try {
    response = await fetch(`${getEnv().apiBaseUrl}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, {
      title: "Network error",
      detail: "The server could not be reached. Check your connection.",
    });
  }

  if (!response.ok) throw new ApiError(response.status, await parseProblem(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** A short, user-facing message for any error thrown by apiFetch or elsewhere. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Too many requests. Please wait a moment and try again.";
    if (error.status >= 500) return "Something went wrong on our side. Please try again.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}
