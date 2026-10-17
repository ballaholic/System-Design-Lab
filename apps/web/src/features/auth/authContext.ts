import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  /** The most recent auth event; PASSWORD_RECOVERY marks a session opened from a reset link. */
  lastEvent: AuthChangeEvent | null;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
