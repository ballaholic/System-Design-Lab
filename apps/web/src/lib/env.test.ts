import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import { initials } from "@/lib/initials";

describe("parseEnv", () => {
  it("accepts a complete configuration and trims a trailing slash from the API URL", () => {
    const result = parseEnv({
      VITE_SUPABASE_URL: "https://abc.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
      VITE_API_BASE_URL: "https://api.example.com/",
    });
    expect(result).toEqual({
      ok: true,
      env: {
        supabaseUrl: "https://abc.supabase.co",
        supabasePublishableKey: "sb_publishable_0123456789abcdef",
        apiBaseUrl: "https://api.example.com",
      },
    });
  });

  it("defaults the API base URL to same-origin", () => {
    const result = parseEnv({
      VITE_SUPABASE_URL: "https://abc.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "x".repeat(30),
    });
    expect(result.ok && result.env.apiBaseUrl).toBe("");
  });

  it("reports every missing value", () => {
    const result = parseEnv({});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems).toHaveLength(2);
  });
});

describe("initials", () => {
  it.each([
    ["Ada Lovelace", "AL"],
    ["grace", "GR"],
    ["  Alan   Mathison Turing ", "AT"],
    ["", "?"],
  ])("%s → %s", (name, expected) => expect(initials(name)).toBe(expected));
});
