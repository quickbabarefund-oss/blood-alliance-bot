import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

type AdminAuthCtx = {
  isAdmin: boolean;
  loading: boolean;
  login: (password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
};

const Ctx = createContext<AdminAuthCtx | null>(null);
const STORAGE_KEY = "admin_auth_token_v1";

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem(STORAGE_KEY);
    if (!token) { setLoading(false); return; }
    supabase.functions
      .invoke("admin-auth", { body: { action: "verify", token } })
      .then(({ data }) => {
        if (data?.ok) setIsAdmin(true);
        else sessionStorage.removeItem(STORAGE_KEY);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(password: string) {
    const { data, error } = await supabase.functions.invoke("admin-auth", {
      body: { action: "login", password },
    });
    if (error || !data?.ok) {
      return { ok: false, error: data?.error ?? error?.message ?? "Login failed" };
    }
    sessionStorage.setItem(STORAGE_KEY, data.token);
    setIsAdmin(true);
    return { ok: true };
  }

  function logout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setIsAdmin(false);
  }

  return <Ctx.Provider value={{ isAdmin, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return ctx;
}
