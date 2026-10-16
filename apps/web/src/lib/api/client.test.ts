import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, errorMessage, parseProblem } from "@/lib/api/client";

const getSession = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: () => getSession() } } }));

const problemJson = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/problem+json" } });

describe("parseProblem", () => {
  it("reads RFC 9457 problem details", async () => {
    const problem = await parseProblem(
      problemJson(400, { title: "Validation failed", errors: { displayName: ["Too long"] } }),
    );
    expect(problem).toMatchObject({
      status: 400,
      title: "Validation failed",
      errors: { displayName: ["Too long"] },
    });
  });

  it("falls back to the status text for non-JSON bodies", async () => {
    const problem = await parseProblem(new Response("<html>", { status: 502, statusText: "Bad Gateway" }));
    expect(problem).toEqual({ status: 502, title: "Bad Gateway" });
  });
});

describe("apiFetch", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    getSession.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("sends the Supabase access token as a bearer token", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "u1" }), { status: 200 }));

    await expect(apiFetch("/api/me")).resolves.toEqual({ id: "u1" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/me");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token-123");
  });

  it("omits the Authorization header when signed out", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiFetch("/api/anything")).resolves.toBeUndefined();
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).has("Authorization")).toBe(false);
  });

  it("throws ApiError with field errors for problem responses", async () => {
    fetchMock.mockResolvedValue(
      problemJson(400, { title: "Invalid", errors: { displayName: ["Required"] } }),
    );

    const error = await apiFetch("/api/me", { method: "PATCH", body: "{}" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).fieldErrors).toEqual({ displayName: ["Required"] });
  });

  it("turns network failures into a status-0 ApiError", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await apiFetch("/api/me").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0, problem: { title: "Network error" } });
  });
});

describe("errorMessage", () => {
  it("hides server internals and explains rate limiting", () => {
    expect(errorMessage(new ApiError(500, { detail: "NullReferenceException at ..." }))).toBe(
      "Something went wrong on our side. Please try again.",
    );
    expect(errorMessage(new ApiError(429, {}))).toMatch(/Too many requests/);
    expect(errorMessage(new ApiError(404, { detail: "Not found here" }))).toBe("Not found here");
  });
});
