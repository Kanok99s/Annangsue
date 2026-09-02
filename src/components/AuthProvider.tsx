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
import { SignInDialog } from "@/components/SignInDialog";

// ---------------------------------------------------------------------------
// Auth context + sign-in prompt.
//
// The app is NOT locked behind an account: everyone can upload a book, read it
// side by side, and look words up. An account is only needed to *persist* —
// saved words and a synced library. Signing in is offered at the point of
// need via `askSignIn()`, which opens a dialog without navigating away (so a
// guest's currently-open book and word are never lost).
// ---------------------------------------------------------------------------

type AuthContextValue = {
  /** "loading" while the stored session is resolved on startup. */
  status: "loading" | "ready";
  user: User | null;
  /** Whether the sign-in prompt is currently open. */
  promptOpen: boolean;
  /** Opens the sign-in prompt. Pass a sentence describing why it's needed. */
  askSignIn: (purpose?: string) => void;
  closeSignIn: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  status: "loading",
  user: null,
  promptOpen: false,
  askSignIn: () => {},
  closeSignIn: () => {},
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
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [user, setUser] = useState<User | null>(null);
  // Non-null while the sign-in prompt is open; the string is the reason shown.
  const [signInPrompt, setSignInPrompt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setUser(data.session?.user ?? null);
        setStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setStatus("ready");
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setStatus("ready");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // The /login route is for signing in only — a signed-in user is sent home.
  useEffect(() => {
    if (status !== "ready" || !user || pathname !== "/login") return;
    void navigate({ to: "/" });
  }, [status, user, pathname, navigate]);

  // Signing in dismisses any pending prompt automatically.
  useEffect(() => {
    if (user) setSignInPrompt(null);
  }, [user]);

  // Everything below only renders once the session is known (SSR emits the
  // splash too, so hydration never mismatches).
  if (status === "loading") return <Splash />;

  const askSignIn = (purpose?: string) => setSignInPrompt(purpose ?? "");
  const closeSignIn = () => setSignInPrompt(null);
  const signOut = async () => {
    setSignInPrompt(null);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        promptOpen: signInPrompt !== null,
        askSignIn,
        closeSignIn,
        signOut,
      }}
    >
      {children}
      <SignInDialog
        open={signInPrompt !== null}
        purpose={signInPrompt ?? undefined}
        onClose={closeSignIn}
      />
    </AuthContext.Provider>
  );
}
