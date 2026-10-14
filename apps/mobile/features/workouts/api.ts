import * as Crypto from "expo-crypto";
import { ConnectionError, apiFetch } from "@/services/api";
import { deviceOffline, loadOffline, offlineAccess, offlineOwner } from "@/services/offlineStore";
import { queueWorkoutPerformance, syncWorkoutPerformance, workoutRead } from "./storage";
import { WorkoutLog, WorkoutPerformance, WorkoutPlan, WorkoutProgress, WorkoutProposal, WorkoutTemplate } from "./types";

const ROOT = "/api/v1/workouts";
export function workoutPath(path: string, groupId?: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams({ ...params, ...(groupId ? { household_id: groupId } : {}) }).toString();
  return `${ROOT}/${path}${query ? `?${query}` : ""}`;
}
export function workoutKey(owner: string | null, name: string, scope = "personal", ...parts: string[]) { return ["workouts", owner, name, scope, ...parts]; }
export async function workoutWrite<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  if (deviceOffline()) throw new ConnectionError("Reconnect to change workouts. Only personal performance logs can be saved offline.");
  return apiFetch<T>(`${ROOT}/${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
export async function getWorkoutTemplates(groupId?: string, discover = false): Promise<{ items: WorkoutTemplate[]; total: number }> {
  const items: WorkoutTemplate[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await workoutRead<{ items: WorkoutTemplate[]; total: number }>(workoutPath("templates", groupId, { ...(discover ? { discover: "true" } : {}), limit: "100", offset: String(offset) }));
    items.push(...page.items);
    if (items.length >= page.total || page.items.length < 100) return { items, total: page.total };
  }
}
export function getWorkoutPlan(groupId?: string, week?: string) { return workoutRead<WorkoutPlan>(workoutPath(week ? "plans/history" : "plans/current", groupId, week ? { week_start: week } : {})); }
export function chooseWorkout(templateId: string, groupId?: string, canManage = true, slotDate?: string | null) {
  if (groupId && !canManage) return workoutWrite("proposals", "POST", { household_id: groupId, template_id: templateId });
  return workoutWrite("plans/slots", "POST", { template_id: templateId, ...(groupId ? { household_id: groupId } : {}), ...(slotDate !== undefined ? { slot_date: slotDate } : {}) });
}
export function getWorkoutProposals(groupId: string) { return workoutRead<{ items: WorkoutProposal[] } | WorkoutProposal[]>(workoutPath("proposals", groupId)); }
export function ownWorkoutLogs(rows: WorkoutLog[], owner: string | null) { return rows.filter(row => (!row.user_id || row.user_id === owner) && (!row.owner_id || row.owner_id === owner)); }
export async function getWorkoutLogs() {
  const items: WorkoutLog[] = [];
  for (let offset = 0; ; offset += 100) {
    const result = await workoutRead<{ items: WorkoutLog[] }>(workoutPath("logs", undefined, { limit: "100", offset: String(offset) }));
    items.push(...ownWorkoutLogs(result.items, offlineOwner()));
    if (result.items.length < 100) return { items };
  }
}
export function getWorkoutProgress() { return workoutRead<WorkoutProgress>(workoutPath("progress")); }
export async function saveWorkoutPerformance(values: WorkoutPerformance, requestId = Crypto.randomUUID(), snapshot?: WorkoutTemplate) {
  const owner = offlineOwner();
  if (!owner) throw new ConnectionError("Sign in before saving a session.");
  const auth = await loadOffline(owner);
  if (offlineOwner() !== owner) throw new Error("Account changed. Try again.");
  if (!deviceOffline() && !offlineAccess(auth)) {
    await workoutWrite(`logs/${encodeURIComponent(requestId)}`, "PUT", values);
    return { requestId, pending: false };
  }
  await queueWorkoutPerformance(requestId, values, snapshot);
  await syncWorkoutPerformance();
  return { requestId, pending: true };
}
