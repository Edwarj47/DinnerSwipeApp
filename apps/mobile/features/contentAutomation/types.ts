import { WorkoutExercise, WorkoutCategory } from "@/features/workouts/types";
import type { PhotoCredit } from "@/services/photoCredit";

export type Campaign = {
  id: string;
  status: string;
  time_zone: string;
  start_date: string;
  end_date: string;
  days_total: number;
  completed_days: number;
  pending_count: number;
};

export type BatchSummary = {
  id: string;
  scheduled_date: string;
  status: string;
  recipe_count: number;
  workout_count: number;
  pending_count: number;
  approved_count: number;
  dismissed_count: number;
  report: { reasons: string[] };
};

export type RecipePayload = {
  name?: string;
  description?: string | null;
  meal_type?: string;
  difficulty?: string;
  cuisine?: string | null;
  tags?: string[];
  servings?: number;
  prep_minutes?: number | null;
  cook_minutes?: number | null;
  total_minutes?: number | null;
  ingredients: { original_text: string }[];
  instructions: { text: string }[];
  nutrition?: { calories?: number | null; protein_g?: number | null; carbs_g?: number | null; fat_g?: number | null; fiber_g?: number | null } | null;
};

export type WorkoutPayload = {
  title: string;
  category: WorkoutCategory;
  description?: string;
  exercises: WorkoutExercise[];
};

type CandidateBase = {
  id: string;
  status: string;
  title: string;
  photo_url: string | null;
  photo_credit?: PhotoCredit | null;
  source_url: string | null;
  source_name: string | null;
  warnings: string[];
};

export type Candidate = CandidateBase & ({ kind: "recipe"; payload: RecipePayload } | { kind: "workout"; payload: WorkoutPayload });
export type Batch = BatchSummary & { recipes: Candidate[]; workouts: Candidate[] };
export type ContentAutomation = { campaign: Campaign | null; batches: BatchSummary[] };

export const isPreparing = (status: string) => ["scheduled", "queued", "running", "generating", "processing"].includes(status);
export const statusLabel = (status: string) => status.replace(/_/g, " ").replace(/^./, value => value.toUpperCase());

export function reportReason(reason: string) {
  const shortfall = /^(recipe|workout)_shortfall:(\d+)\/(\d+)$/.exec(reason);
  if (shortfall) return `${shortfall[1] === "recipe" ? "Recipe" : "Workout"} shortfall: ${shortfall[2]}/${shortfall[3]}`;
  return /^[a-z]+(?:_[a-z]+)+$/.test(reason) ? statusLabel(reason) : reason;
}

export function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function sourceLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal")) return null;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) return null;
    return url.href;
  } catch { return null; }
}
