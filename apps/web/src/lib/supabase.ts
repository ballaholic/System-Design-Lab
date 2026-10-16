import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

const env = getEnv();

/**
 * Supabase is used for authentication only (ADR-006). Application data goes through the API.
 * PKCE: email confirmation, password recovery and OAuth links return with ?code=, which the client
 * exchanges for a session on load (detectSessionInUrl).
 */
export const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
