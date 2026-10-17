import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { useAuth } from "@/features/auth/authContext";

export interface Me {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean | null;
  createdAt: string;
}

export const meQueryKey = ["me"] as const;

export function useMe() {
  const { status, session } = useAuth();
  return useQuery({
    // Keyed by user so a different sign-in never sees a cached profile.
    queryKey: [...meQueryKey, session?.user.id],
    queryFn: () => apiFetch<Me>("/api/me"),
    enabled: status === "authenticated",
    staleTime: 60_000,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: (input: { displayName: string }) =>
      apiFetch<Me>("/api/me", { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (me) => queryClient.setQueryData([...meQueryKey, session?.user.id], me),
  });
}
