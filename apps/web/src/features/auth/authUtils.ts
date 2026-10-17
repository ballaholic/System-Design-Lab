import { AuthError } from "@supabase/supabase-js";
import { z } from "zod";

/** Only allow same-app relative paths as post-login destinations (prevents open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** Absolute URL for Supabase redirects back into this app. */
export function appUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

const messages: Record<string, string> = {
  invalid_credentials: "Email or password is incorrect.",
  email_not_confirmed: "Please confirm your email address first. Check your inbox for the confirmation link.",
  weak_password: "Choose a stronger password.",
  same_password: "The new password must be different from the current one.",
  over_email_send_rate_limit: "Too many emails sent. Please wait a few minutes and try again.",
  over_request_rate_limit: "Too many attempts. Please wait a moment and try again.",
  email_address_invalid: "This email address can't be used.",
  signup_disabled: "Sign-ups are currently disabled.",
  session_expired: "Your session has expired. Please sign in again.",
  otp_expired: "This link has expired or was already used.",
};

export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthError) {
    if (error.code && messages[error.code]) return messages[error.code]!;
    if (error.status === 429) return messages.over_request_rate_limit!;
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

/** Supabase reports failed email/OAuth redirects in query or hash parameters. */
export function redirectError(location: { search: string; hash: string }): string | null {
  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const code = params.get("error_code") ?? hash.get("error_code");
  const description = params.get("error_description") ?? hash.get("error_description");
  if (!code && !description && !params.get("error") && !hash.get("error")) return null;
  if (code && messages[code]) return messages[code]!;
  return description ?? "The sign-in link could not be used.";
}

// ---- form schemas ----

const email = z.email("Enter a valid email address").max(254);
const password = z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters");

export const loginSchema = z.object({ email, password: z.string().min(1, "Enter your password") });

export const registerSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a display name").max(60, "Use at most 60 characters"),
  email,
  password,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
