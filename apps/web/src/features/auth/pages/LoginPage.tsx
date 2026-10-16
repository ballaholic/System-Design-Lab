import { zodResolver } from "@hookform/resolvers/zod";
import { AuthError } from "@supabase/supabase-js";
import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import type { z } from "zod";
import { FormField } from "@/components/FormField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/AuthCard";
import { useAuth } from "@/features/auth/authContext";
import { authErrorMessage, loginSchema, safeNextPath } from "@/features/auth/authUtils";
import { GoogleSignInButton, OrDivider } from "@/features/auth/GoogleSignInButton";
import { useResendConfirmation } from "@/features/auth/useResendConfirmation";
import { supabase } from "@/lib/supabase";

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [formError, setFormError] = useState<string | null>(null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  if (status === "authenticated") return <Navigate to={next} replace />;

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    setUnconfirmedEmail(null);
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      if (error instanceof AuthError && error.code === "email_not_confirmed")
        setUnconfirmedEmail(values.email);
      setFormError(authErrorMessage(error));
      return;
    }
    navigate(next, { replace: true });
  }

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Pick up where you left off."
      footer={
        <span>
          New here?{" "}
          <Link to="/register" className="text-foreground underline-offset-4 hover:underline">
            Create an account
          </Link>
        </span>
      }
    >
      <GoogleSignInButton next={next} />
      <OrDivider />
      <form className="grid gap-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
        {formError && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>
              {formError}
              {unconfirmedEmail && <ResendLink email={unconfirmedEmail} />}
            </AlertDescription>
          </Alert>
        )}
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email}
          {...form.register("email")}
        />
        <div className="grid gap-1.5">
          <FormField
            label="Password"
            type="password"
            autoComplete="current-password"
            error={errors.password}
            {...form.register("password")}
          />
          <Link
            to="/forgot-password"
            className="justify-self-end text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}

function ResendLink({ email }: { email: string }) {
  const { resend, disabled, cooldown } = useResendConfirmation(email);
  return (
    <button
      type="button"
      className="mt-1 block text-left underline underline-offset-4 disabled:no-underline disabled:opacity-60"
      disabled={disabled}
      onClick={() => void resend()}
    >
      {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend confirmation email"}
    </button>
  );
}
