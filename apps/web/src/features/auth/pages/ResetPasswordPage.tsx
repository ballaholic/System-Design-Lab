import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import type { z } from "zod";
import { FormField } from "@/components/FormField";
import { PageSpinner } from "@/components/PageSpinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/AuthCard";
import { useAuth } from "@/features/auth/authContext";
import { authErrorMessage, redirectError, resetPasswordSchema } from "@/features/auth/authUtils";
import { supabase } from "@/lib/supabase";

type ResetValues = z.infer<typeof resetPasswordSchema>;

/**
 * Landing page for the reset email. supabase-js exchanges the ?code= for a recovery session on load;
 * a signed-in user may also use this page to set a new password.
 */
export function ResetPasswordPage() {
  const { status } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const linkError = redirectError(location);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ResetValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const { errors, isSubmitting } = form.formState;

  if (status === "loading") return <PageSpinner label="Verifying reset link" />;

  if (linkError || status === "anonymous") {
    return (
      <AuthCard title="Reset link not valid">
        <p className="text-sm text-muted-foreground">
          {linkError ??
            "This reset link has expired, was already used, or was opened in a different browser."}
        </p>
        <Button asChild>
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </AuthCard>
    );
  }

  async function onSubmit({ password }: ResetValues) {
    setFormError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setFormError(authErrorMessage(error));
      return;
    }
    toast.success("Password updated");
    navigate("/", { replace: true });
  }

  return (
    <AuthCard title="Choose a new password">
      <form className="grid gap-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
        {formError && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <FormField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          error={errors.password}
          {...form.register("password")}
        />
        <FormField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword}
          {...form.register("confirmPassword")}
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Update password"}
        </Button>
      </form>
    </AuthCard>
  );
}
