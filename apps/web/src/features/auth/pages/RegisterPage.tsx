import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, MailCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate } from "react-router";
import type { z } from "zod";
import { FormField } from "@/components/FormField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/AuthCard";
import { useAuth } from "@/features/auth/authContext";
import { appUrl, authErrorMessage, registerSchema } from "@/features/auth/authUtils";
import { GoogleSignInButton, OrDivider } from "@/features/auth/GoogleSignInButton";
import { useResendConfirmation } from "@/features/auth/useResendConfirmation";
import { supabase } from "@/lib/supabase";

type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const { status } = useAuth();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: "", email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  if (status === "authenticated" && !sentTo) return <Navigate to="/" replace />;
  if (sentTo) return <CheckEmail email={sentTo} />;

  async function onSubmit(values: RegisterValues) {
    setFormError(null);
    const { error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        emailRedirectTo: appUrl("/auth/callback"),
        data: { display_name: values.displayName },
      },
    });
    if (error) {
      setFormError(authErrorMessage(error));
      return;
    }
    // Supabase answers the same way for new and existing addresses, so this never reveals who has an account.
    setSentTo(values.email);
  }

  return (
    <AuthCard
      title="Create your account"
      description="Save designs, track challenge progress and get AI feedback."
      footer={
        <span>
          Already have an account?{" "}
          <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </span>
      }
    >
      <GoogleSignInButton next="/" />
      <OrDivider />
      <form className="grid gap-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
        {formError && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <FormField
          label="Display name"
          autoComplete="nickname"
          error={errors.displayName}
          {...form.register("displayName")}
        />
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email}
          {...form.register("email")}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          error={errors.password}
          {...form.register("password")}
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}

function CheckEmail({ email }: { email: string }) {
  const { resend, disabled, cooldown } = useResendConfirmation(email);
  return (
    <AuthCard title="Check your email" description="One more step before you can sign in.">
      <div className="flex items-start gap-3 text-sm">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <p className="text-muted-foreground">
          If <span className="font-medium text-foreground">{email}</span> can be registered, we've sent a
          confirmation link to it. Open the link in this browser to finish creating your account.
        </p>
      </div>
      <Button variant="outline" disabled={disabled} onClick={() => void resend()}>
        {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend email"}
      </Button>
      <Button variant="ghost" asChild>
        <Link to="/login">Back to sign in</Link>
      </Button>
    </AuthCard>
  );
}
