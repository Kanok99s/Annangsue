import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Session gate + auth context.
//
// The app is fully client-rendered behind a sign-in wall: while the session is
// still being resolved we show a branded splash (this is also what SSR emits,
// so hydration always matches), then redirect signed-out users to /login and
// signed-in users away from /login into the app.
// ---------------------------------------------------------------------------

type AuthContextValue = {
  user: User | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <p className="animate-pulse font-serif text-3xl font-extrabold tracking-tight text-foreground">
        Annangsue
      </p>
    </div>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setUser(data.session?.user ?? null);
        setPhase("ready");
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setPhase("ready");
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setPhase("ready");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const onLoginRoute = pathname === "/login";

  useEffect(() => {
    if (phase === "loading") return;
    if (!user && !onLoginRoute) void navigate({ to: "/login" });
    else if (user && onLoginRoute) void navigate({ to: "/" });
  }, [phase, user, onLoginRoute, navigate]);

  // Only render protected pages once we know a session exists (and vice versa:
  // render /login only while signed out). Everything else stays on the splash
  // while a redirect lands.
  const showApp = phase === "ready" && (user ? !onLoginRoute : onLoginRoute);
  if (!showApp) return <Splash />;

  return (
    <AuthContext.Provider
      value={{ user, signOut: async () => void (await supabase.auth.signOut()) }}
    >
      {children}
    </AuthContext.Provider>
  );
}
