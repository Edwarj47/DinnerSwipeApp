import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { offlineOwner } from "./offlineStore";

export type ExperienceMode = "nutrition" | "workouts";
export type WorkoutWeightUnit = "kg" | "lb";
export type ExperiencePreferences = { mode: ExperienceMode; weight_unit: WorkoutWeightUnit };
const PREFIX = "dinnerSwipe.workouts.preferences.v1.";
export const useWorkoutMode = create<ExperiencePreferences & { owner: string | null; enabled: boolean }>(() => ({
  owner: null, enabled: false, mode: "nutrition", weight_unit: "kg"
}));
let generation = 0;
let seeded = 0;
let queryClient: QueryClient | null = null;
let preferenceWrites: Promise<unknown> = Promise.resolve();
export function bindWorkoutModeClient(client: QueryClient | null) { queryClient = client; }

export function parseExperiencePreferences(value: unknown): ExperiencePreferences {
  const input = value && typeof value === "object" ? value as Partial<ExperiencePreferences> : {};
  return { mode: input.mode === "workouts" ? "workouts" : "nutrition", weight_unit: input.weight_unit === "lb" ? "lb" : "kg" };
}
export function resetWorkoutMode(owner: string | null = null) {
  generation++; seeded++;
  useWorkoutMode.setState({ owner, enabled: false, mode: "nutrition", weight_unit: "kg" });
}
export async function restoreWorkoutPreferences(owner: string) {
  const version = generation, revision = seeded;
  const raw = await AsyncStorage.getItem(PREFIX + owner);
  if (version !== generation || revision !== seeded || offlineOwner() !== owner) return;
  if (raw) useWorkoutMode.setState(parseExperiencePreferences(JSON.parse(raw)));
}
export function seedWorkoutPreferences(value: unknown) {
  if (value && useWorkoutMode.getState().owner === offlineOwner()) { seeded++; useWorkoutMode.setState(parseExperiencePreferences(value)); }
}
export function setWorkoutsEnabled(enabled: boolean) {
  useWorkoutMode.setState({ enabled, ...(!enabled ? { mode: "nutrition" as const } : {}) });
}
export async function updateWorkoutPreferences(patch: Partial<ExperiencePreferences>) {
  const task = async () => {
    const owner = offlineOwner(), state = useWorkoutMode.getState(), version = generation;
    if (!owner || state.owner !== owner) throw new Error("Sign in before changing your experience.");
    const next = parseExperiencePreferences({ mode: state.mode, weight_unit: state.weight_unit, ...patch });
    if (next.mode === "workouts" && !state.enabled) throw new Error("Workouts are not available.");
    const client = queryClient;
    await client?.cancelQueries({ queryKey: ["profile"] });
    const response = await apiFetch<{ experience_preferences?: ExperiencePreferences }>("/api/v1/profile/experience", { method: "PATCH", body: JSON.stringify(next) });
    if (version !== generation || offlineOwner() !== owner) return;
    seeded++;
    client?.setQueryData(["profile"], (previous: Record<string, unknown> | undefined) => ({ ...previous, ...response, experience_preferences: next }));
    await AsyncStorage.setItem(PREFIX + owner, JSON.stringify(next));
    if (version === generation && offlineOwner() === owner) useWorkoutMode.setState(next);
  };
  const result = preferenceWrites.then(task, task);
  preferenceWrites = result.catch(() => undefined);
  return result;
}
export function weightInKg(value: number, unit: WorkoutWeightUnit) { return unit === "lb" ? value / 2.2046226218 : value; }
export function displayWorkoutWeight(kg: number, unit: WorkoutWeightUnit) {
  return Number((unit === "lb" ? kg * 2.2046226218 : kg).toFixed(2)).toString();
}
export function workoutTabVisibility(mode: ExperienceMode) { return { grocery: mode !== "workouts", recipesTitle: mode === "workouts" ? "Workouts" : "Recipes" }; }
