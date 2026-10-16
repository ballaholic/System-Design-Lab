import { z } from "zod";

const envSchema = z.object({
  VITE_SUPABASE_URL: z.url({ message: "VITE_SUPABASE_URL must be the Supabase project URL" }),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(20, "VITE_SUPABASE_PUBLISHABLE_KEY is missing"),
  // Empty means same origin (the Vite dev server proxies /api to the local API).
  VITE_API_BASE_URL: z.union([z.literal(""), z.url()]).default(""),
});

export interface AppEnv {
  supabaseUrl: string;
  supabasePublishableKey: string;
  apiBaseUrl: string;
}

export type EnvResult = { ok: true; env: AppEnv } | { ok: false; problems: string[] };

export function parseEnv(source: Record<string, unknown>): EnvResult {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  return {
    ok: true,
    env: {
      supabaseUrl: parsed.data.VITE_SUPABASE_URL,
      supabasePublishableKey: parsed.data.VITE_SUPABASE_PUBLISHABLE_KEY,
      apiBaseUrl: parsed.data.VITE_API_BASE_URL.replace(/\/$/, ""),
    },
  };
}

export const envResult = parseEnv(import.meta.env);

/** Only call after main.tsx has confirmed envResult.ok. */
export function getEnv(): AppEnv {
  if (!envResult.ok) throw new Error(`Invalid configuration: ${envResult.problems.join("; ")}`);
  return envResult.env;
}
