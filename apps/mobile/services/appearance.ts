import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient } from "@tanstack/react-query";
import { AppState } from "react-native";
import { apiFetch, getStoredSessionIdentity } from "./api";
import { AccentColor, DEFAULT_ACCENT, parseAppearance } from "./appearancePalette";
import { applyAppIcon } from "./appIcon";
import { deviceOffline, offlineOwner, useOfflineStatus } from "./offlineStore";
import { UserProfile } from "./types";
import { useAppearance } from "./appearanceState";
export { useAppearance } from "./appearanceState";

const PREFIX = "dinnerSwipe.appearance.v1.";
let generation = 0, revision = 0;
let storageWrites: Promise<unknown> = Promise.resolve();
let iconWrites: Promise<unknown> = Promise.resolve();
let iconRequest = 0;
let startupOwner: string | null = null;

function current(owner: string | null, version: number) { return generation === version && offlineOwner() === owner && useAppearance.getState().owner === owner; }
export function resetAppearance(owner: string | null) {
  const state = useAppearance.getState(), previous = state.owner ?? startupOwner;
  const accent = owner && owner === startupOwner && !state.owner ? state.savedAccent : DEFAULT_ACCENT;
  startupOwner = null;
  generation++; revision++; iconRequest++;
  useAppearance.setState({ owner, accent, savedAccent: accent, ready: !owner && !!previous, pending: false, error: "", iconError: "" });
  if (!owner && previous) void syncAppearanceIcon();
}
useOfflineStatus.subscribe(() => { if (useAppearance.getState().owner !== offlineOwner()) resetAppearance(offlineOwner()); });

export async function restoreStartupAppearance() {
  const version = generation, started = revision, state = useAppearance.getState();
  if (offlineOwner() || state.owner || state.ready || state.pending) return;
  try {
    const session = await getStoredSessionIdentity();
    if (!session) return;
    const raw = await AsyncStorage.getItem(PREFIX + session.owner);
    if (!raw || !session.isCurrent() || version !== generation || started !== revision || offlineOwner() || useAppearance.getState().owner) return;
    const { accent } = parseAppearance(JSON.parse(raw));
    startupOwner = session.owner;
    // Keep owner/ready unchanged: a cached color must never unlock content or change the launcher icon.
    useAppearance.setState({ accent, savedAccent: accent });
  } catch { /* A missing/unreadable cache must not prevent normal device authentication. */ }
}

function cache(owner: string, accent: AccentColor) {
  const task = storageWrites.then(() => AsyncStorage.setItem(PREFIX + owner, JSON.stringify({ accent })));
  storageWrites = task.catch(() => undefined);
  return task;
}
export async function restoreAppearance(owner: string) {
  const version = generation, started = revision;
  let raw: string | null = null;
  try { raw = await AsyncStorage.getItem(PREFIX + owner); } catch { /* Server preferences can still restore the theme. */ }
  if (!current(owner, version) || revision !== started || useAppearance.getState().pending) return;
  let value: unknown;
  try { value = raw ? JSON.parse(raw) : undefined; } catch { value = undefined; }
  const { accent } = parseAppearance(value);
  useAppearance.setState({ accent, savedAccent: accent, ready: Boolean(raw) });
}
export function seedAppearance(value: unknown, owner: string) {
  const state = useAppearance.getState();
  if (offlineOwner() !== owner || state.owner !== owner || state.pending) return;
  revision++;
  const { accent } = parseAppearance(value);
  useAppearance.setState({ accent, savedAccent: accent, ready: true });
  void cache(owner, accent).catch(() => undefined);
}

export function syncAppearanceIcon() {
  const request = ++iconRequest, version = generation, state = useAppearance.getState();
  const task = async () => {
    if (!state.ready || state.pending || request !== iconRequest || !current(state.owner, version) || AppState.currentState === "background" || AppState.currentState === "inactive") return;
    try {
      await applyAppIcon(state.savedAccent);
      if (current(state.owner, version) && request === iconRequest) useAppearance.setState({ iconError: "" });
    } catch {
      if (current(state.owner, version) && request === iconRequest) useAppearance.setState({ iconError: "Couldn't update the app icon." });
    }
  };
  const result = iconWrites.then(task, task);
  iconWrites = result.catch(() => undefined);
  return result;
}

export async function updateAppearance(accent: AccentColor, client: QueryClient) {
  const state = useAppearance.getState(), owner = offlineOwner(), version = generation;
  if (!owner || owner !== state.owner || !state.ready || state.pending) throw new Error("Appearance isn't ready yet.");
  if (deviceOffline()) throw new Error("Connect to save an accent color.");
  revision++;
  useAppearance.setState({ accent, pending: true, error: "" });
  try {
    await client.cancelQueries({ queryKey: ["appearance-profile", owner] });
    if (!current(owner, version)) return;
    const result = await apiFetch<UserProfile>("/api/v1/profile/appearance", { method: "PATCH", body: JSON.stringify({ accent }) });
    if (!current(owner, version)) return;
    const saved = parseAppearance(result.appearance_preferences);
    useAppearance.setState({ accent: saved.accent, savedAccent: saved.accent, pending: false, ready: true });
    client.setQueryData(["appearance-profile", owner], result);
    client.setQueryData(["profile"], (previous: UserProfile | undefined) => ({ ...previous, ...result }));
    await cache(owner, saved.accent).catch(() => {
      if (current(owner, version)) useAppearance.setState({ error: "Color saved. Couldn't cache it on this device." });
    });
    if (current(owner, version)) await syncAppearanceIcon();
  } catch {
    if (current(owner, version)) useAppearance.setState({ accent: state.savedAccent, pending: false, error: "Couldn't save the accent color. Try again." });
  }
}
