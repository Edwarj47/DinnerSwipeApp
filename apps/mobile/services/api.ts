import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import { clearPlanningReminders } from "./planningReminders";
import { MacroConfirmation, PremiumStatus } from "./types";
import { cacheable, changeOffline, deviceOffline, findMacro, loadOffline, macroAfter, offlineAccess, offlineOwner,
  OfflineEdit, overlay, readOffline, setDeviceOffline, setOfflineOwner, useOfflineStatus } from "./offlineStore";

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "web" && typeof window !== "undefined"
    ? window.location.origin
    : "http://127.0.0.1:8108");
const ACCESS_TOKEN_KEY = "dinnerSwipeAccessToken";
const REFRESH_TOKEN_KEY = "dinnerSwipeRefreshToken";
const OFFLINE_OWNER_KEY = "dinnerSwipeOfflineOwner";
let sessionEpoch = 0;
let syncInFlight: Promise<void> | null = null;
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export class ConnectionError extends Error {}
export function isAuthenticationError(error: unknown) { return error instanceof ApiError && error.status === 401; }
const authListeners = new Set<() => void>();
let refreshInFlight: Promise<boolean> | null = null;

export type AuthTokenPair = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
};

function webStorage() {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  return window.localStorage;
}

async function setStorageItem(key: string, value: string) {
  if (Platform.OS === "web") {
    webStorage()?.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

async function getStorageItem(key: string) {
  if (Platform.OS === "web") {
    return webStorage()?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function deleteStorageItem(key: string) {
  if (Platform.OS === "web") {
    webStorage()?.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

function emitAuthChanged() {
  for (const listener of authListeners) {
    listener();
  }
}

export function addAuthChangeListener(listener: () => void) {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

export async function setAuthTokens(tokens: AuthTokenPair, refreshing = false) {
  if (!refreshing) {
    sessionEpoch++;
    setOfflineOwner(null);
    await deleteStorageItem(OFFLINE_OWNER_KEY);
  }
  await setStorageItem(ACCESS_TOKEN_KEY, tokens.access_token);
  if (tokens.refresh_token) {
    await setStorageItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  }
  emitAuthChanged();
}

export async function setToken(token: string) {
  await setStorageItem(ACCESS_TOKEN_KEY, token);
  emitAuthChanged();
}

export async function getToken() {
  return getStorageItem(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken() {
  return getStorageItem(REFRESH_TOKEN_KEY);
}

export async function clearAuthTokens() {
  sessionEpoch++;
  setOfflineOwner(null);
  await clearPlanningReminders().catch(() => undefined);
  await Promise.all([deleteStorageItem(ACCESS_TOKEN_KEY), deleteStorageItem(REFRESH_TOKEN_KEY), deleteStorageItem(OFFLINE_OWNER_KEY)]);
  emitAuthChanged();
}

async function doRefreshAuthTokens() {
  const epoch = sessionEpoch;
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;
  const response = await request("/api/v1/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (epoch !== sessionEpoch) throw new ApiError("Account changed. Try again.", 409);
  if (!response.ok) {
    if (response.status === 401) {
      await clearAuthTokens();
      return false;
    }
    throw new ApiError(await responseErrorMessage(response), response.status);
  }
  await setAuthTokens((await response.json()) as AuthTokenPair, true);
  return true;
}

export async function refreshAuthTokens() {
  refreshInFlight ??= doRefreshAuthTokens().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function shouldSetJsonContentType(init: RequestInit) {
  if (!init.body) return true;
  if (typeof FormData !== "undefined" && init.body instanceof FormData) return false;
  return true;
}

function validationMessage(issue: unknown) {
  if (!issue || typeof issue !== "object") return "";
  const detail = issue as { loc?: unknown[]; msg?: unknown; type?: unknown };
  const field =
    Array.isArray(detail.loc) && detail.loc.length > 0
      ? String(detail.loc[detail.loc.length - 1] ?? "")
      : "";
  const message = typeof detail.msg === "string" ? detail.msg : "";
  const type = typeof detail.type === "string" ? detail.type : "";

  if (field === "email") return "Enter a valid email address.";
  if (field === "password" && (type.includes("too_short") || message.includes("at least"))) {
    return "Password must be at least 8 characters.";
  }
  if (message) return message.replace(/^Value error,\s*/i, "");
  return "";
}

function errorMessageFromBody(body: string, fallback: string) {
  if (!body.trim()) return fallback;
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown };
    const detail = parsed.detail ?? parsed.message;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const messages = detail.map(validationMessage).filter(Boolean);
      return messages.length ? Array.from(new Set(messages)).join(" ") : fallback;
    }
  } catch {
    return body;
  }
  return fallback;
}

async function responseErrorMessage(response: Response) {
  const body = await response.text();
  return errorMessageFromBody(body, `Request failed with status ${response.status}.`);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const epoch = sessionEpoch;
  if (!offlineOwner() && await getToken()) {
    const savedOwner = await getStorageItem(OFFLINE_OWNER_KEY);
    setOfflineOwner(savedOwner);
    if (savedOwner) {
      try { useOfflineStatus.setState({ edits: (await loadOffline(savedOwner)).edits }); }
      catch { useOfflineStatus.setState({ storageError: "Unable to read offline data. Reconnect before editing." }); }
    }
  }
  const owner = offlineOwner();
  const method = init.method?.toUpperCase() ?? "GET";
  const stored = owner ? await loadOffline(owner).catch(() => undefined) : undefined;
  if (owner && stored?.subscription?.offline_sync_version === 1 && method !== "GET") {
    let edit = makeOfflineEdit(path, init, stored);
    if (edit) {
      if (!offlineAccess(stored, edit.kind.startsWith("macro_"))) throw new ConnectionError("Reconnect to verify access before saving. Your pending changes are still saved.");
      if (Platform.OS === "web" && !navigator.locks) throw new Error("Offline edits need a browser with secure storage locking. Use the Android app or a current browser.");
      edit = await changeOffline(owner, data => {
        if (owner !== offlineOwner()) throw new Error("Account changed. Try again.");
        const prepared = makeOfflineEdit(path, init, data)!;
        if (!offlineAccess(data, prepared.kind.startsWith("macro_"))) throw new Error("Reconnect to verify your access.");
        macroAfter(prepared);
        data.edits.push(prepared);
        return prepared;
      });
      if (!deviceOffline()) await syncOffline();
      return (macroAfter(edit) ?? { status: "saved_on_device" }) as T;
    }
  }
  try {
    if (deviceOffline()) throw new ConnectionError("You're offline. Reconnect to use this action.");
    const result = await authorizedFetch<T>(path, init, true);
    if (epoch !== sessionEpoch) throw new ApiError("Account changed. Try again.", 409);
    if (path === "/api/v1/auth/status") {
      const session = result as { user_id?: string; email: string };
      if (session.user_id) {
        if (offlineOwner() !== session.user_id) setOfflineOwner(session.user_id);
        await setStorageItem(OFFLINE_OWNER_KEY, session.user_id);
        await remember(session.user_id, data => { data.session = session as { user_id: string; email: string }; });
      }
    } else if (owner && path === "/api/v1/subscription/status") {
      await remember(owner, data => { data.subscription = result as PremiumStatus; data.verifiedAt = Date.now(); });
    } else if (owner && method === "GET" && cacheable(path)) {
      await remember(owner, data => {
        data.cache[path] = { data: result, at: Date.now() };
        if (path === "/api/v1/households" && Array.isArray(result)) {
          const allowed = new Set((result as { id: string }[]).map(group => group.id));
          for (const key of Object.keys(data.cache)) {
            const groupId = key.match(/\/households\/([^/]+)\//)?.[1];
            if (groupId && !allowed.has(groupId)) delete data.cache[key];
          }
        }
      });
      const latest = await loadOffline(owner).catch(() => undefined);
      return overlay(path, result, latest?.edits ?? []) as T;
    }
    if (owner && method !== "GET" && path.startsWith("/api/v1/groups")) {
      await remember(owner, data => { data.cache = Object.fromEntries(Object.entries(data.cache).filter(([key]) => key.startsWith("/api/v1/macros/"))); });
    }
    if (owner && method !== "GET" && path.startsWith("/api/v1/recipes")) {
      await remember(owner, data => {
        for (const key of Object.keys(data.cache)) if (key.startsWith("/api/v1/recipes")) delete data.cache[key];
      });
    }
    return result;
  } catch (error) {
    if (epoch !== sessionEpoch || init.signal?.aborted) throw error;
    if (error instanceof ConnectionError) {
      setDeviceOffline(true);
      if (owner) {
        const data = await loadOffline(owner);
        if (path === "/api/v1/auth/status" && offlineAccess(data)) return data.session as T;
        if (path === "/api/v1/subscription/status" && offlineAccess(data)) return data.subscription as T;
        if (method === "GET" && cacheable(path)) return readOffline(data, path) as T;
      }
    }
    // An explicit server denial must not fall back to previously authorized content.
    if (owner && error instanceof ApiError && [401, 402, 403].includes(error.status)) {
      await remember(owner, data => { data.subscription = undefined; });
    }
    throw error;
  }
}

async function authorizedFetch<T>(path: string, init: RequestInit, canRefresh: boolean): Promise<T> {
  const epoch = sessionEpoch;
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && shouldSetJsonContentType(init)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await request(path, { ...init, headers });
  if (epoch !== sessionEpoch) throw new ApiError("Account changed. Try again.", 409);
  if (response.status === 401 && canRefresh && path !== "/api/v1/auth/refresh" && path !== "/api/v1/auth/login" && path !== "/api/v1/auth/register") {
    const refreshed = await refreshAuthTokens();
    if (refreshed) return authorizedFetch<T>(path, init, false);
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/v1/auth/")) await clearAuthTokens();
    throw new ApiError(await responseErrorMessage(response), response.status);
  }
  return response.json() as Promise<T>;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort);
  if (init.signal?.aborted) abort();
  const slowAction = init.body instanceof FormData || path.includes("ingestion") || path.includes("ai-recipes");
  const timer = setTimeout(abort, slowAction ? 120000 : 12000);
  try {
    const response = await fetch(`${API_URL}${path}`, { ...init, signal: controller.signal });
    if (response.status >= 500 || response.status === 408 || response.status === 429) throw new ConnectionError("Unable to reach Dinner Swipe. Your saved work is still on this device.");
    return response;
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw error instanceof ConnectionError ? error : new ConnectionError("Unable to connect. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

async function remember(id: string, update: Parameters<typeof changeOffline>[1]) {
  try { await changeOffline(id, update); }
  catch { useOfflineStatus.setState({ storageError: "Unable to save offline data on this device." }); }
}

function makeOfflineEdit(path: string, init: RequestInit, data: Awaited<ReturnType<typeof loadOffline>>): OfflineEdit | null {
  const method = init.method?.toUpperCase();
  const values = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
  const operation_id = Crypto.randomUUID();
  if (method === "PATCH" && /^\/api\/v1\/(?:households\/[^/]+\/)?grocery-lists\/items\/[^/]+$/.test(path)
    && Object.keys(values).every(key => ["is_checked", "quantity"].includes(key))) {
    const target_id = path.split("/").pop()!;
    const household_id = path.match(/\/households\/([^/]+)\//)?.[1];
    const listPath = `${household_id ? `/api/v1/households/${household_id}` : "/api/v1"}/grocery-lists/current`;
    const list = readOffline(data, listPath) as { items: { id: string; revision?: string; display_name: string }[] };
    const item = list.items.find(row => row.id === target_id);
    if (!item?.revision) throw new Error("Reconnect to download this grocery item before editing.");
    return { operation_id, kind: "grocery_update", target_id, revision: item.revision, values, label: item.display_name, ...(household_id ? { household_id } : {}) };
  }
  if (path === "/api/v1/macros/entries" && method === "POST" && !values.weekly_plan_slot_id) {
    if (!values.meal_date) throw new Error("Choose a date for this entry.");
    readOffline(data, `/api/v1/macros/entries?start_date=${values.meal_date}&end_date=${values.meal_date}`);
    return { operation_id, kind: "macro_create", values: { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, ...values }, label: String(values.entry_name ?? "Macro entry") };
  }
  if (/^\/api\/v1\/macros\/entries\/[^/]+$/.test(path) && (method === "PUT" || method === "DELETE")) {
    const target_id = path.split("/").pop()!;
    const row = findMacro(data, target_id);
    if (!row?.revision) throw new Error("Reconnect to download this macro entry before editing.");
    if (values.meal_date && values.meal_date !== row.meal_date) readOffline(data, `/api/v1/macros/entries?start_date=${values.meal_date}&end_date=${values.meal_date}`);
    return { operation_id, kind: method === "DELETE" ? "macro_delete" : "macro_update", target_id,
      revision: row.revision, values, before: row, label: row.entry_name ?? row.recipe_name ?? "Macro entry" };
  }
  return null;
}

export async function syncOffline(): Promise<void> {
  if (syncInFlight) return syncInFlight;
  const id = offlineOwner();
  if (!id || deviceOffline()) return;
  const epoch = sessionEpoch;
  syncInFlight = (async () => {
    useOfflineStatus.setState({ syncing: true });
    try {
      for (let attempt = 0; attempt < 100 && epoch === sessionEpoch && offlineOwner() === id; attempt++) {
        const edit = (await loadOffline(id)).edits[0];
        if (!edit || edit.issue) break;
        try {
          const { operation_id, kind, target_id, revision, values, household_id } = edit;
          const response = await authorizedFetch<{ result: Record<string, unknown> }>("/api/v1/offline/sync", {
            method: "POST", body: JSON.stringify({ operation_id, kind, target_id, revision, values, ...(household_id ? { household_id } : {}) })
          }, true);
          if (epoch !== sessionEpoch) break;
          await changeOffline(id, data => {
            // Another PWA tab may already have acknowledged this operation.
            if (!data.edits.some(item => item.operation_id === edit.operation_id)) return;
            for (const [path, entry] of Object.entries(data.cache)) {
              if (/\/grocery-lists\/current$/.test(path) && edit.kind === "grocery_update" && path.match(/\/households\/([^/]+)\//)?.[1] === edit.household_id) {
                entry.data = overlay(path, entry.data, [edit]);
                const item = (entry.data as { items: Record<string, unknown>[] }).items.find(row => row.id === edit.target_id);
                if (item) Object.assign(item, response.result);
              }
              if (path.startsWith("/api/v1/macros/entries") && edit.kind.startsWith("macro_")) {
                entry.data = (overlay(path, entry.data, [edit]) as MacroConfirmation[]).map(row => row.id === response.result.id ? { ...row, ...response.result } : row);
              }
              if (edit.kind.startsWith("macro_") && /\/macros\/(summary|analytics)/.test(path)) delete data.cache[path];
            }
            data.edits = data.edits.filter(item => item.operation_id !== edit.operation_id);
            for (const next of data.edits) if (next.revision === `pending:${edit.operation_id}`) next.revision = response.result.revision as string;
          });
        } catch (error) {
          if (error instanceof ConnectionError) { setDeviceOffline(true); break; }
          if (epoch !== sessionEpoch) break;
          await changeOffline(id, data => {
            const pending = data.edits.find(item => item.operation_id === edit.operation_id);
            if (pending) pending.issue = error instanceof Error ? error.message : "Unable to sync this change.";
          });
          break;
        }
      }
    } finally { useOfflineStatus.setState({ syncing: false }); }
  })().finally(() => { syncInFlight = null; });
  return syncInFlight;
}

export async function reconnectOffline() {
  try {
    await request("/api/v1/health", {});
    setDeviceOffline(false);
    if (!await getToken()) return;
    await apiFetch("/api/v1/auth/status");
    await apiFetch("/api/v1/subscription/status");
    await syncOffline();
    emitAuthChanged();
  } catch (error) { if (error instanceof ConnectionError) setDeviceOffline(true); }
}

export function recheckSession() { emitAuthChanged(); }

export async function retryOfflineSync() {
  const id = offlineOwner();
  if (id) await changeOffline(id, data => { for (const edit of data.edits) edit.issue = undefined; });
  await reconnectOffline();
}

export function savedMessage(message: string) {
  return useOfflineStatus.getState().edits.length ? "Saved on this device. Waiting to sync." : message;
}

export async function warmOfflineCache() {
  const id = offlineOwner();
  if (!id || deviceOffline()) return;
  const data = await loadOffline(id).catch(() => undefined);
  if (!data) return;
  const paths = ["/api/v1/profile", "/api/v1/weekly-plans/current", "/api/v1/grocery-lists/current", "/api/v1/recipes?limit=100&offset=0", "/api/v1/recipes?collection=library&limit=100&offset=0"];
  if (data.subscription?.premium_active) {
    const start = new Date(), end = new Date();
    start.setDate(start.getDate() - 30); end.setDate(end.getDate() + 3);
    paths.push(`/api/v1/macros/entries?start_date=${start.toISOString().slice(0, 10)}&end_date=${end.toISOString().slice(0, 10)}`, "/api/v1/macros/targets");
  }
  for (const path of paths) {
    if (offlineOwner() !== id || deviceOffline()) break;
    try { await apiFetch(path); } catch { /* A failed download never erases a previously saved response. */ }
  }
}
