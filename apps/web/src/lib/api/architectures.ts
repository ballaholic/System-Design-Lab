import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/authContext";
import { apiFetch } from "@/lib/api/client";

export interface ArchitectureSummary {
  id: string;
  title: string;
  description: string | null;
  challengeSlug: string | null;
  nodeCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Architecture extends Omit<ArchitectureSummary, "nodeCount"> {
  /** Raw stored document; load it with `loadArchitecture` (migrates and repairs). */
  document: unknown;
}

export interface ArchitecturePage {
  items: ArchitectureSummary[];
  nextCursor: string | null;
}

export interface ImportDesign {
  importKey: string;
  title: string;
  description?: string | null;
  document: unknown;
  challengeSlug?: string | null;
}

/** A guest challenge attempt, imported with its design (AUTH-9). */
export interface ImportAttempt {
  importKey: string;
  challengeSlug: string;
  challengeVersion: number;
  mode: "guided";
  status: "in_progress" | "completed" | "abandoned";
  currentStageId: string;
  /** The import key of the attempt's design, from this or an earlier import. */
  architectureImportKey?: string;
  stageResults: unknown;
  exerciseAnswers: unknown;
  hintsRevealed: string[];
  startedAt: string;
  lastActivityAt: string;
  completedAt?: string | null;
}

export interface ImportResult {
  results: Array<{ importKey: string; id: string; created: boolean }>;
  attemptResults?: Array<{ importKey: string; id: string; created: boolean }>;
}

export const architecturesKey = (userId: string | undefined) => ["architectures", userId] as const;

export const architecturesApi = {
  list: (cursor?: string) =>
    apiFetch<ArchitecturePage>(`/api/architectures${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  get: (id: string) => apiFetch<Architecture>(`/api/architectures/${id}`),
  create: (input: {
    title: string;
    description?: string | null;
    document: unknown;
    challengeSlug?: string;
  }) => apiFetch<Architecture>("/api/architectures", { method: "POST", body: JSON.stringify(input) }),
  /** Optimistic concurrency (ADR-018): a stale version fails with 412. */
  save: (id: string, document: unknown, version: number) =>
    apiFetch<Architecture>(`/api/architectures/${id}`, {
      method: "PUT",
      headers: { "If-Match": `"${version}"` },
      body: JSON.stringify({ document }),
    }),
  rename: (id: string, input: { title?: string; description?: string | null }) =>
    apiFetch<Architecture>(`/api/architectures/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  remove: (id: string) => apiFetch<void>(`/api/architectures/${id}`, { method: "DELETE" }),
  duplicate: (id: string) => apiFetch<Architecture>(`/api/architectures/${id}/duplicate`, { method: "POST" }),
  import: (designs: ImportDesign[], attempts: ImportAttempt[] = []) =>
    apiFetch<ImportResult>("/api/architectures/import", {
      method: "POST",
      body: JSON.stringify(attempts.length > 0 ? { designs, attempts } : { designs }),
    }),
};

export function useArchitectureList() {
  const { status, session } = useAuth();
  return useQuery({
    queryKey: [...architecturesKey(session?.user.id), "list"],
    queryFn: async () => {
      // Users rarely have many designs; follow cursors so the list is complete.
      const items: ArchitectureSummary[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await architecturesApi.list(cursor);
        items.push(...result.items);
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      return items;
    },
    enabled: status === "authenticated",
  });
}

export function useArchitecture(id: string | undefined) {
  const { status, session } = useAuth();
  return useQuery({
    queryKey: [...architecturesKey(session?.user.id), "detail", id],
    queryFn: () => architecturesApi.get(id!),
    enabled: status === "authenticated" && !!id,
    // The editor owns the document once loaded; don't refetch it underneath the user.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

function useInvalidateList() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return () => queryClient.invalidateQueries({ queryKey: [...architecturesKey(session?.user.id), "list"] });
}

export function useRenameArchitecture() {
  const invalidate = useInvalidateList();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => architecturesApi.rename(id, { title }),
    onSuccess: () => void invalidate(),
  });
}

export function useDeleteArchitecture() {
  const invalidate = useInvalidateList();
  return useMutation({ mutationFn: architecturesApi.remove, onSuccess: () => void invalidate() });
}

export function useDuplicateArchitecture() {
  const invalidate = useInvalidateList();
  return useMutation({ mutationFn: architecturesApi.duplicate, onSuccess: () => void invalidate() });
}

export interface SnapshotSummary {
  id: string;
  label: string;
  createdAt: string;
  nodeCount: number;
}

export const snapshotsApi = {
  list: (architectureId: string) =>
    apiFetch<{ items: SnapshotSummary[] }>(`/api/architectures/${architectureId}/snapshots`),
  /** Without a document, the server snapshots what it has stored. */
  create: (architectureId: string, label: string, document?: unknown) =>
    apiFetch<SnapshotSummary>(`/api/architectures/${architectureId}/snapshots`, {
      method: "POST",
      body: JSON.stringify(document === undefined ? { label } : { label, document }),
    }),
};
