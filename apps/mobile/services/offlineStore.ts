import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { create } from "zustand";
import { MacroConfirmation, PremiumStatus, Recipe } from "./types";

export type OfflineEdit = {
  operation_id: string;
  kind: "grocery_update" | "macro_create" | "macro_update" | "macro_delete";
  target_id?: string;
  revision?: string;
  values: Record<string, unknown>;
  before?: MacroConfirmation;
  label: string;
  issue?: string;
};
type CacheEntry = { data: unknown; at: number };
export type OfflineData = {
  version: 1;
  session?: { user_id: string; email: string };
  subscription?: PremiumStatus;
  verifiedAt?: number;
  seenAt: number;
  cache: Record<string, CacheEntry>;
  edits: OfflineEdit[];
};
export const useOfflineStatus = create<{
  offline: boolean; syncing: boolean; edits: OfflineEdit[]; storageError: string; noticeSince: number | null;
}>(() => ({ offline: false, syncing: false, edits: [], storageError: "", noticeSince: null }));
// Keep the delay across screen changes and outbox updates, not per checkbox tap.
useOfflineStatus.subscribe(state => {
  const pending = state.offline || state.syncing || state.edits.length > 0;
  if (pending && state.noticeSince === null) useOfflineStatus.setState({ noticeSince: Date.now() });
  else if (!pending && state.noticeSince !== null) useOfflineStatus.setState({ noticeSince: null });
});
const PREFIX = "dinnerSwipe.offline.v1.";
let owner: string | null = null;
let writes: Promise<unknown> = Promise.resolve();
export function setOfflineOwner(id: string | null) {
  owner = id;
  useOfflineStatus.setState({ edits: [], storageError: "", syncing: false, noticeSince: null });
}
export function offlineOwner() { return owner; }
export function deviceOffline() { return useOfflineStatus.getState().offline; }
export function setDeviceOffline(offline: boolean) { useOfflineStatus.setState({ offline }); }

export async function loadOffline(id: string): Promise<OfflineData> {
  const raw = await AsyncStorage.getItem(PREFIX + id);
  if (!raw) return { version: 1, seenAt: 0, cache: {}, edits: [] };
  const data = JSON.parse(raw) as OfflineData;
  if (data.version !== 1 || !data.cache || !Array.isArray(data.edits)) throw new Error("Offline storage needs attention. Reconnect before editing.");
  return data;
}

// One atomic document keeps the outbox and its read snapshots consistent after a crash.
// Web Locks also prevent two PWA tabs from losing one another's queued changes.
export async function changeOffline<T>(id: string, change: (data: OfflineData) => T): Promise<T> {
  const task = async () => {
    const apply = async () => {
      const data = await loadOffline(id);
      const result = change(data);
      data.seenAt = Math.max(data.seenAt, Date.now());
      const oldest = Object.keys(data.cache).sort((a, b) => data.cache[a].at - data.cache[b].at);
      while (JSON.stringify(data).length > 450000 && oldest.length) delete data.cache[oldest.shift()!];
      if (data.edits.length > 100 || JSON.stringify(data).length > 500000) throw new Error("Offline storage is full. Sync your changes before adding more.");
      await AsyncStorage.setItem(PREFIX + id, JSON.stringify(data));
      if (owner === id) useOfflineStatus.setState({ edits: data.edits, storageError: "" });
      return result;
    };
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.locks) {
      return navigator.locks.request(PREFIX + id, apply);
    }
    return apply();
  };
  const result = writes.then(task, task);
  writes = result.catch(() => undefined);
  return result;
}

export function offlineAccess(data: OfflineData, premium = false) {
  const now = Date.now();
  const until = Date.parse(data.subscription?.offline_until ?? "");
  const checked = data.verifiedAt ?? 0;
  return Boolean(data.session && data.subscription?.basic_active && (!premium || data.subscription.premium_active)
    && now >= checked - 60000 && now >= data.seenAt - 60000 && now < until && now - checked < 72 * 60 * 60 * 1000);
}

export function cacheable(path: string) {
  const base = path.split("?")[0];
  return /^\/api\/v1\/recipes(?:\/[a-zA-Z0-9-]+)?$/.test(base)
    || ["/api/v1/profile", "/api/v1/weekly-plans/current", "/api/v1/grocery-lists/current", "/api/v1/grocery-lists/pantry",
      "/api/v1/macros/entries", "/api/v1/macros/targets", "/api/v1/macros/summary", "/api/v1/macros/analytics"].includes(base);
}
function weekStamp(time: number) {
  const day = new Date(time); day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
export function readOffline(data: OfflineData, path: string): unknown {
  if (!offlineAccess(data, path.startsWith("/api/v1/macros/"))) throw new Error("Reconnect to verify your access. Your pending changes are still saved.");
  let cached = data.cache[path];
  if (!cached && path.startsWith("/api/v1/recipes?")) {
    const requested = new URLSearchParams(path.split("?")[1]);
    const signature = (query: URLSearchParams) => {
      const copy = new URLSearchParams(query);
      for (const field of ["q", "offset", "limit"]) copy.delete(field);
      copy.sort();
      return copy.toString();
    };
    // Search only downloaded rows with the same server-side collection and filters.
    const pages = Object.entries(data.cache).filter(([key]) => {
      const query = new URLSearchParams(key.split("?")[1]);
      return key.startsWith("/api/v1/recipes?") && !query.get("q") && signature(query) === signature(requested);
    }).sort((a, b) => b[1].at - a[1].at);
    if (pages.length) {
      const unique = new Map<string, Recipe>();
      for (const [, page] of pages) for (const recipe of page.data as Recipe[]) if (!unique.has(recipe.id)) unique.set(recipe.id, recipe);
      const rows = [...unique.values()].filter(recipe => recipe.name.toLowerCase().includes((requested.get("q") ?? "").toLowerCase()));
      const offset = Number(requested.get("offset") ?? 0), limit = Number(requested.get("limit") ?? 30);
      cached = { at: pages[0][1].at, data: rows.slice(offset, offset + limit) };
    }
  }
  if (path.startsWith("/api/v1/macros/entries?")) {
    const query = new URLSearchParams(path.split("?")[1]);
    const start = query.get("start_date"), end = query.get("end_date");
    if (!cached && start && end) {
      for (const [key, candidate] of Object.entries(data.cache)) {
        if (!key.startsWith("/api/v1/macros/entries?")) continue;
        const range = new URLSearchParams(key.split("?")[1]);
        if ((range.get("start_date") ?? "z") <= start && (range.get("end_date") ?? "") >= end) {
          cached = { at: candidate.at, data: (candidate.data as MacroConfirmation[]).filter(row => row.meal_date >= start && row.meal_date <= end) };
          break;
        }
      }
    }
  }
  if (!cached) throw new Error("This information is not downloaded yet. Connect and try again.");
  if ((path === "/api/v1/weekly-plans/current" || path === "/api/v1/grocery-lists/current") && weekStamp(cached.at) !== weekStamp(Date.now())) {
    throw new Error("Connect to download this week's plan and groceries. Last week's changes are still saved.");
  }
  return overlay(path, cached.data, data.edits);
}

export function macroAfter(edit: OfflineEdit): MacroConfirmation | undefined {
  if (edit.kind === "macro_delete" || edit.kind === "grocery_update") return undefined;
  const row = { ...(edit.before ?? { id: edit.operation_id, recipe_id: null, weekly_plan_slot_id: null,
    servings_consumed: 1, status: "ate", created_at: new Date().toISOString(), macro_source: "manual" }), ...edit.values,
    revision: `pending:${edit.operation_id}` } as MacroConfirmation;
  const nutrients = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const;
  for (const field of nutrients) {
    if (row.status === "skipped") row[field] = 0;
    else if (!(field in edit.values) && edit.before && row.servings_consumed !== edit.before.servings_consumed) {
      if (edit.before.servings_consumed <= 0) throw new Error("Enter nutrition totals when changing a zero portion.");
      row[field] = edit.before[field] == null ? null : Math.round(edit.before[field]! * row.servings_consumed / edit.before.servings_consumed * 100) / 100;
    }
  }
  return row;
}

export function overlay(path: string, input: unknown, edits: OfflineEdit[]): unknown {
  const data = JSON.parse(JSON.stringify(input));
  if (path === "/api/v1/grocery-lists/current") {
    for (const edit of edits.filter(item => item.kind === "grocery_update")) {
      const item = data.items.find((row: { id: string }) => row.id === edit.target_id);
      if (item) Object.assign(item, edit.values, { revision: `pending:${edit.operation_id}` });
    }
  }
  if (path.startsWith("/api/v1/macros/entries")) {
    let rows = data as MacroConfirmation[];
    const query = new URLSearchParams(path.split("?")[1]);
    for (const edit of edits.filter(item => item.kind.startsWith("macro_"))) {
      rows = rows.filter(row => row.id !== (edit.target_id ?? edit.operation_id));
      const after = macroAfter(edit);
      if (after && (!query.get("start_date") || after.meal_date >= query.get("start_date")!) && (!query.get("end_date") || after.meal_date <= query.get("end_date")!)) rows.push(after);
    }
    return rows;
  }
  return data;
}

export function findMacro(data: OfflineData, id: string): MacroConfirmation | undefined {
  for (const [path, cached] of Object.entries(data.cache)) {
    if (path.startsWith("/api/v1/macros/entries")) {
      const row = (overlay(path, cached.data, data.edits) as MacroConfirmation[]).find(item => item.id === id);
      if (row) return row;
    }
  }
  return data.edits.map(macroAfter).find(row => row?.id === id);
}

export async function discardOfflineChange(id: string) {
  if (!owner) return;
  await changeOffline(owner, data => {
    const selected = data.edits.find(edit => edit.operation_id === id);
    if (!selected) return;
    const target = selected.target_id ?? selected.operation_id;
    data.edits = data.edits.filter(edit => (edit.target_id ?? edit.operation_id) !== target);
  });
}
