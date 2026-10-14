import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { create } from "zustand";
import { ApiError, ConnectionError, apiFetch } from "@/services/api";
import { deviceOffline, loadOffline, offlineAccess, offlineOwner, useOfflineStatus } from "@/services/offlineStore";
import { resetWorkoutMode } from "@/services/workoutMode";
import { monday } from "@/features/planner/WeekNavigator";
import { WorkoutPerformance, WorkoutTemplate } from "./types";

const PREFIX = "dinnerSwipe.workouts.offline.v1.";
export const WORKOUT_QUEUE_LIMIT = 100;
const BYTE_LIMIT = 500000;
type Pending = { request_uuid: string; values: WorkoutPerformance; snapshot?: WorkoutTemplate; revision: number; issue?: string };
type Document = { version: 1; owner: string; queue: Pending[]; cache: Record<string, { at: number; value: unknown }> };
export const useWorkoutQueue = create<{ pending: Pending[]; syncing: boolean; error: string }>(() => ({ pending: [], syncing: false, error: "" }));
let writes: Promise<unknown> = Promise.resolve();
let sync: Promise<void> | null = null;
let observedOwner = offlineOwner();
let epoch = 0;

function checkOwner(id: string, version = epoch) {
  if (offlineOwner() !== id || version !== epoch) throw new Error("Account changed. Try again.");
}
async function read(id: string): Promise<Document> {
  const raw = await AsyncStorage.getItem(PREFIX + id);
  if (!raw) return { version: 1, owner: id, queue: [], cache: {} };
  const data = JSON.parse(raw) as Document;
  if (data.version !== 1 || data.owner !== id || !Array.isArray(data.queue) || !data.cache) throw new Error("Workout storage needs attention. Reconnect before saving.");
  return data;
}
async function locked<T>(id: string, task: () => Promise<T>) {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(PREFIX + id, task);
  return task();
}
async function change<T>(id: string, edit: (data: Document) => T): Promise<T> {
  const version = epoch;
  const task = () => locked(id, async () => {
    checkOwner(id, version);
    const data = await read(id);
    checkOwner(id, version);
    const result = edit(data);
    const oldest = Object.keys(data.cache).sort((a, b) => data.cache[a].at - data.cache[b].at);
    while (JSON.stringify(data).length > 450000 && oldest.length) delete data.cache[oldest.shift()!];
    if (data.queue.length > WORKOUT_QUEUE_LIMIT || JSON.stringify(data).length > BYTE_LIMIT) throw new Error("Workout storage is full. Sync your sessions before saving more.");
    checkOwner(id, version);
    await AsyncStorage.setItem(PREFIX + id, JSON.stringify(data));
    checkOwner(id, version);
    useWorkoutQueue.setState({ pending: data.queue });
    return result;
  });
  const result = writes.then(task, task);
  writes = result.catch(() => undefined);
  return result;
}
export async function clearWorkoutOwner(id: string) {
  const task = () => locked(id, () => AsyncStorage.removeItem(PREFIX + id));
  const result = writes.then(task, task);
  writes = result.catch(() => undefined);
  await result;
}
// This subscription survives tab unmounts and runs synchronously when auth changes ownership.
useOfflineStatus.subscribe(() => {
  const next = offlineOwner();
  if (next === observedOwner) return;
  const previous = observedOwner;
  observedOwner = next; epoch++;
  resetWorkoutMode(next);
  useWorkoutQueue.setState({ pending: [], syncing: false, error: "" });
  if (previous) void clearWorkoutOwner(previous).catch(() => undefined);
});
export async function restoreWorkoutQueue() {
  const id = offlineOwner(), version = epoch;
  if (!id) return;
  const data = await read(id);
  checkOwner(id, version);
  useWorkoutQueue.setState({ pending: data.queue });
}
async function grace(id: string) {
  const auth = await loadOffline(id);
  checkOwner(id);
  if (!offlineAccess(auth) || auth.session?.user_id !== id) throw new ConnectionError("Reconnect to verify access before saving workouts.");
}
export async function workoutRead<T>(path: string): Promise<T> {
  if (!path.startsWith("/api/v1/workouts/")) throw new Error("Invalid workout namespace.");
  const id = offlineOwner(), version = epoch;
  if (!id) throw new ConnectionError("Sign in to view workouts.");
  try {
    const result = await apiFetch<T>(path);
    checkOwner(id, version);
    await change(id, data => { data.cache[path] = { at: Date.now(), value: result }; }).catch(() => undefined);
    return result;
  } catch (error) {
    if (error instanceof ApiError && [401, 402, 403, 404].includes(error.status)) {
      const status = error.status;
      if (offlineOwner() === id && version === epoch) await change(id, data => {
        const group = new URLSearchParams(path.split("?")[1]).get("household_id");
        for (const key of Object.keys(data.cache)) {
          if (key === path || (group && new URLSearchParams(key.split("?")[1]).get("household_id") === group)
            || (status === 401 || status === 402)) delete data.cache[key];
        }
      }).catch(() => undefined);
      throw error;
    }
    if (!(error instanceof ConnectionError)) throw error;
    await grace(id);
    checkOwner(id, version);
    const entry = (await read(id)).cache[path];
    checkOwner(id, version);
    if (!entry || Date.now() - entry.at >= 72 * 60 * 60 * 1000) throw new ConnectionError("This workout information is not downloaded. Reconnect and try again.");
    if (path.includes("/plans/current") && monday(new Date(entry.at).toISOString().slice(0, 10)) !== monday(new Date().toISOString().slice(0, 10))) throw new ConnectionError("Reconnect to download this week's workouts.");
    return entry.value as T;
  }
}
export async function queueWorkoutPerformance(request_uuid: string, values: WorkoutPerformance, snapshot?: WorkoutTemplate) {
  const id = offlineOwner(), version = epoch;
  if (!id) throw new ConnectionError("Sign in before saving a session.");
  await grace(id);
  checkOwner(id, version);
  if (Platform.OS === "web" && (typeof navigator === "undefined" || !navigator.locks)) throw new Error("Offline workout logs need secure browser storage locking. Use the Android app or a current browser.");
  await change(id, data => {
    const previous = data.queue.find(item => item.request_uuid === request_uuid);
    if (previous) {
      if (previous.values.template_id !== values.template_id) throw new Error("A session's workout cannot be changed.");
      previous.values = values; previous.revision = (previous.revision ?? 0) + 1; delete previous.issue;
      previous.snapshot ??= snapshot;
    } else data.queue.push({ request_uuid, values, snapshot, revision: 1 });
  });
}
export async function syncWorkoutPerformance(retry = false) {
  if (sync) return sync;
  const id = offlineOwner(), version = epoch;
  if (!id || deviceOffline()) return;
  sync = (async () => {
    useWorkoutQueue.setState({ syncing: true, error: "" });
    try {
      await grace(id);
      if (retry) await change(id, data => { data.queue.forEach(item => { delete item.issue; }); });
      while (offlineOwner() === id && version === epoch && !deviceOffline()) {
        const item = (await read(id)).queue[0];
        checkOwner(id, version);
        if (!item || item.issue) break;
        try {
          await apiFetch(`/api/v1/workouts/logs/${encodeURIComponent(item.request_uuid)}`, { method: "PUT", body: JSON.stringify(item.values) });
          checkOwner(id, version);
          await change(id, data => {
            data.queue = data.queue.filter(row => row.request_uuid !== item.request_uuid || row.revision !== item.revision);
            for (const path of Object.keys(data.cache)) if (/\/(logs|progress)(\?|$)/.test(path)) delete data.cache[path];
          });
        } catch (error) {
          if (version !== epoch || offlineOwner() !== id) break;
          if (error instanceof ConnectionError) break;
          await change(id, data => { const row = data.queue.find(row => row.request_uuid === item.request_uuid); if (row) row.issue = error instanceof Error ? error.message : "Session could not sync."; });
          break;
        }
      }
    } catch (error) {
      if (offlineOwner() === id && version === epoch) useWorkoutQueue.setState({ error: error instanceof Error ? error.message : "Session could not sync." });
    } finally { if (offlineOwner() === id && version === epoch) useWorkoutQueue.setState({ syncing: false }); }
  })().finally(() => { sync = null; });
  return sync;
}
