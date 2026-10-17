import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck, CircleAlert } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FormField } from "@/components/FormField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/authContext";
import { ApiError, errorMessage } from "@/lib/api/client";
import { useMe, useUpdateProfile } from "@/lib/api/me";

const profileSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a display name").max(60, "Use at most 60 characters"),
});
type ProfileValues = z.infer<typeof profileSchema>;

export function ProfilePage() {
  const { data: me, isPending, error } = useMe();
  const { session } = useAuth();
  const update = useUpdateProfile();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: "" },
  });
  const { errors, isDirty } = form.formState;

  useEffect(() => {
    if (me) form.reset({ displayName: me.displayName });
  }, [me, form]);

  async function onSubmit(values: ProfileValues) {
    try {
      const saved = await update.mutateAsync(values);
      form.reset({ displayName: saved.displayName });
      toast.success("Profile updated");
    } catch (e) {
      // Server-side validation errors map onto the matching field.
      const fieldError = e instanceof ApiError ? e.fieldErrors.displayName?.[0] : undefined;
      if (fieldError) form.setError("displayName", { message: fieldError });
      else toast.error(errorMessage(e));
    }
  }

  const providers = (session?.user.app_metadata.providers as string[] | undefined) ?? [];

  return (
    <div className="grid max-w-2xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">Your account details.</p>
      </header>

      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{errorMessage(error)}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Account</h2>
          </CardTitle>
          <CardDescription>Managed by your sign-in provider.</CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            me && (
              <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  {me.email ?? "—"}
                  {me.emailVerified && (
                    <Badge variant="secondary" className="gap-1">
                      <BadgeCheck className="size-3" aria-hidden /> Verified
                    </Badge>
                  )}
                </dd>
                <dt className="text-muted-foreground">Sign-in methods</dt>
                <dd>{providers.length ? providers.map(providerLabel).join(", ") : "—"}</dd>
                <dt className="text-muted-foreground">Member since</dt>
                <dd>{new Date(me.createdAt).toLocaleDateString(undefined, { dateStyle: "long" })}</dd>
              </dl>
            )
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Display name</h2>
          </CardTitle>
          <CardDescription>Shown in the app. Your email is never shown to others.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:max-w-sm" noValidate onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              label="Display name"
              autoComplete="nickname"
              disabled={isPending}
              error={errors.displayName}
              {...form.register("displayName")}
            />
            <Button type="submit" className="w-fit" disabled={!isDirty || update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function providerLabel(provider: string): string {
  return provider === "email" ? "Email and password" : provider.charAt(0).toUpperCase() + provider.slice(1);
}
