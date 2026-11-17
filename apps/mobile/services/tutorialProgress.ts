import AsyncStorage from "@react-native-async-storage/async-storage";

export type TutorialTask = "meals" | "workouts" | "macros";
export type TutorialAction = "meal-planned" | "meal-scheduled" | "groceries-built" | "workout-planned" | "workout-logged" | "macro-logged";
export type TutorialEvidence = { owner: string; action: TutorialAction; scope: string; id: string; relatedId?: string; date?: string };
export type TutorialProgress = { version: 1; task: TutorialTask; index: number; scope: string;
  completed: string[]; skipped: string[]; status: "active" | "paused" | "complete" | "skipped" };
const PREFIX = "dinnerSwipe.tutorial.tasks.v1.";
const listeners = new Set<(event: TutorialEvidence) => void>();
let writes: Promise<unknown> = Promise.resolve();
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" && value.length <= 120 ? value : undefined;
export function listenTutorialEvidence(listener: (event: TutorialEvidence) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function tutorialEvidence(owner: string, path: string, method: string, input: unknown, output: unknown): TutorialEvidence | null {
  const body = record(input), result = record(output), route = path.split("?")[0];
  const scope = route.match(/^\/api\/v1\/households\/([^/]+)\//)?.[1] ?? text(body.household_id) ?? "personal";
  const make = (action: TutorialAction, id: unknown, extra: Partial<TutorialEvidence> = {}): TutorialEvidence | null =>
    text(id) ? { owner, action, scope, id: text(id)!, ...extra } : null;
  if (method === "POST" && route === "/api/v1/recipes/swipes" && body.action === "add") return make("meal-planned", result.planned_slot_id);
  if (["POST", "PUT"].includes(method) && /\/weekly-plans\/current\/slots(?:\/[^/]+)?$/.test(route) && text(body.slot_date)) {
    const slot = (Array.isArray(result.slots) ? result.slots : []).map(record).find(row =>
      row.slot_date === body.slot_date && (body.recipe_id ? row.recipe_id === body.recipe_id : row.id === route.split("/").pop()));
    if (slot) return make("meal-scheduled", slot.id, { relatedId: text(slot.recipe_id), date: text(slot.slot_date) });
  }
  if (method === "POST" && /\/grocery-lists\/current\/regenerate$/.test(route)) return make("groceries-built", result.id);
  if (method === "POST" && route === "/api/v1/workouts/plans/slots") return make("workout-planned", result.id);
  if (method === "PUT" && /^\/api\/v1\/workouts\/logs\/[^/]+$/.test(route)) return make("workout-logged", result.id ?? result.request_uuid, { scope: "personal" });
  if (method === "POST" && route === "/api/v1/nutrition/calculations" && body.destination === "entry") return make("macro-logged", result.entry_id, { scope: "personal", date: text(body.meal_date) });
  if (method === "POST" && route === "/api/v1/offline/sync" && body.kind === "macro_create") return tutorialEvidence(owner, "/api/v1/macros/entries", "POST", body.values, result.result);
  const entry = record(result.entry ?? result);
  if (method === "POST" && (route === "/api/v1/macros/entries" || /\/calculations\/[^/]+\/log$/.test(route)) && entry.status === "ate") {
    return make("macro-logged", entry.id, { scope: "personal", date: text(entry.meal_date) });
  }
  return null;
}
export function observeTutorialResponse(owner: string, path: string, init: RequestInit, result: unknown) {
  if (!listeners.size) return;
  try {
    const evidence = tutorialEvidence(owner, path, init.method?.toUpperCase() ?? "GET", typeof init.body === "string" ? JSON.parse(init.body) : {}, result);
    if (evidence) for (const listener of listeners) listener(evidence);
  } catch { /* Guidance must never prevent a successful app action. */ }
}
export function parseTutorialProgress(value: unknown): TutorialProgress | null {
  const p = record(value);
  if (p.version !== 1 || !["meals", "workouts", "macros"].includes(String(p.task)) || !Number.isInteger(p.index)
    || Number(p.index) < 0 || Number(p.index) > 10 || !text(p.scope) || !Array.isArray(p.completed) || !Array.isArray(p.skipped)
    || !["active", "paused", "complete", "skipped"].includes(String(p.status))) return null;
  return { version: 1, task: p.task as TutorialTask, index: Number(p.index), scope: String(p.scope),
    completed: p.completed.filter(v => !!text(v)).slice(0, 10), skipped: p.skipped.filter(v => !!text(v)).slice(0, 10), status: p.status as TutorialProgress["status"] };
}
export async function loadTutorialProgress(owner: string): Promise<TutorialProgress | null> {
  try { const raw = await AsyncStorage.getItem(PREFIX + owner); return raw ? parseTutorialProgress(JSON.parse(raw)) : null; } catch { return null; }
}
export function saveTutorialProgress(owner: string, value: TutorialProgress) {
  const snapshot = JSON.stringify(value);
  const write = () => AsyncStorage.setItem(PREFIX + owner, snapshot);
  const result = writes.then(write, write); writes = result.catch(() => undefined); return result;
}
