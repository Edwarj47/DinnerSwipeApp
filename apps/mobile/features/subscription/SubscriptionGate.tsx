import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "expo-router";
import { ReactNode, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { apiFetch } from "@/services/api";
import { AppAccessContext, useAuthSession } from "@/services/session";
import { PremiumStatus } from "@/services/types";

const ACCOUNT_PATHS = new Set(["/privacy", "/terms", "/delete-account"]);

export function SubscriptionGate({ children }: { children: ReactNode }) {
  const session = useAuthSession();
  const path = usePathname();
  const queries = useQueryClient();
  const owner = session.userId ?? session.email;
  const current = useRef(owner);
  current.current = owner;
  const enabled = session.authenticated && !ACCOUNT_PATHS.has(path);
  const status = useQuery({ queryKey: ["subscription-status"],
    queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"), enabled, retry: false });
  const welcome = useMutation({
    mutationFn: (_owner: string) => apiFetch<PremiumStatus>("/api/v1/subscription/welcome/start", { method: "POST" }),
    onSuccess: async (_data, requestedOwner) => {
      if (current.current !== requestedOwner) return;
      await queries.invalidateQueries({ queryKey: ["subscription-status"] });
      await queries.invalidateQueries({ queryKey: ["premium-status"] });
    }
  });
  const start = welcome.mutate, reset = welcome.reset;
  useEffect(() => reset(), [owner, reset]);
  useEffect(() => {
    if (enabled && owner && status.data?.welcome_eligible && !status.data.welcome_requires_verification
      && !welcome.isPending && !welcome.isError) start(owner);
  }, [enabled, owner, status.data?.welcome_eligible, status.data?.welcome_requires_verification,
    welcome.isPending, welcome.isError, start]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { void queries.invalidateQueries({ queryKey: ["subscription-status"] }); };
    const listener = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    const end = status.data?.welcome_active ? status.data.welcome_ends_at : status.data?.current_period_end;
    const delay = end ? Date.parse(end) - Date.now() + 100 : NaN;
    const timer = Number.isFinite(delay) && delay > 0
      ? setTimeout(refresh, Math.min(delay, 2147483647)) : undefined;
    return () => { listener.remove(); if (timer) clearTimeout(timer); };
  }, [enabled, queries, status.data?.welcome_active, status.data?.welcome_ends_at, status.data?.current_period_end]);
  // Basic never requires payment or a billing response. AuthGate still owns authentication.
  return <AppAccessContext.Provider value={enabled}>{children}</AppAccessContext.Provider>;
}
