import { ReactNode, useEffect } from "react";
import { Asset } from "expo-asset";
import { useQuery } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";
import { apiFetch } from "@/services/api";
import { offlineOwner, useOfflineStatus } from "@/services/offlineStore";
import { restoreAppearance, seedAppearance, syncAppearanceIcon, useAppearance } from "@/services/appearance";
import { UserProfile } from "@/services/types";
import { appearanceArtwork } from "@/services/appearanceArtwork";

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const owner = useOfflineStatus(() => offlineOwner());
  const accent = useAppearance(state => state.accent), saved = useAppearance(state => state.savedAccent);
  const ready = useAppearance(state => state.ready), pending = useAppearance(state => state.pending);
  const profile = useQuery({ queryKey: ["appearance-profile", owner], enabled: Boolean(owner), retry: false,
    queryFn: async () => {
      const result = await apiFetch<UserProfile>("/api/v1/profile");
      if (offlineOwner() !== owner) throw new Error("Account changed.");
      return result;
    } });
  const refetch = profile.refetch;
  useEffect(() => { if (owner) void restoreAppearance(owner); }, [owner]);
  useEffect(() => { if (owner && profile.data && !profile.isError) seedAppearance(profile.data.appearance_preferences, owner); }, [owner, profile.data, profile.isError]);
  useEffect(() => { if (ready && !pending) void syncAppearanceIcon(); }, [owner, saved, ready, pending]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") { void syncAppearanceIcon(); if (owner) void refetch(); }
    });
    return () => listener.remove();
  }, [owner, refetch]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.type = "image/png";
    link.href = Asset.fromModule(appearanceArtwork(accent)).uri;
  }, [accent]);
  return children;
}
