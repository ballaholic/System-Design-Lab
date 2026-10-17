import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, MailCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import type { z } from "zod";
import { FormField } from "@/components/FormField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/AuthCard";
import { appUrl, authErrorMessage, forgotPasswordSchema } from "@/features/auth/authUtils";
import { supabase } from "@/lib/supabase";

type ForgotValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ForgotValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit({ email }: ForgotValues) {
    setFormError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: appUrl("/reset-password"),
    });
    if (error) {
      setFormError(authErrorMessage(error));
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <AuthCard title="Check your email">
        <div className="flex items-start gap-3 text-sm">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <p className="text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{sentTo}</span>, we've sent
            a link to reset the password. Open it in this browser.
          </p>
        </div>
        <Button variant="ghost" asChild>
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email and we'll send you a reset link."
      footer={
        <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form className="grid gap-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
        {formError && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email}
          {...form.register("email")}
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  );
}
