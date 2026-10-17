import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AuthContext, type AuthContextValue, type AuthStatus } from "@/features/auth/authContext";
import { supabase } from "@/lib/supabase";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [lastEvent, setLastEvent] = useState<AuthChangeEvent | null>(null);

  useEffect(() => {
    let active = true;

    // getSession waits for supabase-js initialisation, including any ?code= exchange in the URL.
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus(data.session ? "authenticated" : "anonymous");
    });

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setLastEvent(event);
      setSession(next);
      setStatus(next ? "authenticated" : "anonymous");
      if (event === "SIGNED_OUT") queryClient.clear();
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      lastEvent,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [status, session, lastEvent],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
