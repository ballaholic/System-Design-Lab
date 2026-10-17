import { AuthApiError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  authErrorMessage,
  redirectError,
  registerSchema,
  resetPasswordSchema,
  safeNextPath,
} from "@/features/auth/authUtils";

describe("safeNextPath", () => {
  it.each([
    ["/profile", "/profile"],
    ["/profile?tab=1", "/profile?tab=1"],
    [null, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("authErrorMessage", () => {
  it("maps known Supabase error codes to friendly messages", () => {
    const error = new AuthApiError("Email not confirmed", 400, "email_not_confirmed");
    expect(authErrorMessage(error)).toMatch(/confirm your email/);
  });

  it("does not distinguish unknown email from wrong password", () => {
    const error = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
    expect(authErrorMessage(error)).toBe("Email or password is incorrect.");
  });

  it("falls back to the provider message for unknown codes", () => {
    expect(authErrorMessage(new AuthApiError("Something specific", 400, "brand_new_code"))).toBe(
      "Something specific",
    );
  });
});

describe("redirectError", () => {
  it("reads errors Supabase appends to redirect URLs", () => {
    expect(redirectError({ search: "?error=access_denied&error_code=otp_expired", hash: "" })).toMatch(
      /expired/,
    );
    expect(redirectError({ search: "", hash: "#error=server_error&error_description=Boom" })).toBe("Boom");
  });

  it("returns null for clean callbacks", () => {
    expect(redirectError({ search: "?code=abc", hash: "" })).toBeNull();
  });
});

describe("form schemas", () => {
  it("requires a password of 8–72 characters on registration", () => {
    const base = { displayName: "Ada", email: "ada@example.com" };
    expect(registerSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "x".repeat(73) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "long-enough" }).success).toBe(true);
  });

  it("rejects mismatched reset passwords on the confirmation field", () => {
    const result = resetPasswordSchema.safeParse({ password: "long-enough", confirmPassword: "different" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});
