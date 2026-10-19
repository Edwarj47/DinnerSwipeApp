import type { PhotoCredit } from "@/services/photoCredit";

export type WorkoutCategory = "upper" | "lower" | "cardio" | "full_body";
export type WorkoutExercise = { name: string; sets?: number; reps?: string; duration_seconds?: number };
export type WorkoutTemplate = {
  id: string; title: string; category: WorkoutCategory; photo_url?: string | null; photo_reference?: string | null; description?: string;
  photo_credit?: PhotoCredit | null;
  exercises: WorkoutExercise[]; owner_id: string; shared?: boolean; discover_enabled?: boolean;
  revision?: string;
};
export type WorkoutSlot = { id: string; slot_date: string | null; sort_order: number; template_id: string; snapshot: WorkoutTemplate };
export type WorkoutPlan = { id: string; week_start: string; read_only: boolean; slots: WorkoutSlot[] };
export type WorkoutSet = { exercise_index: number; set_number: number; reps?: number; weight_kg?: number; duration_seconds?: number };
export type WorkoutPerformance = { template_id: string; performed_on: string; completed: boolean; notes?: string; sets: WorkoutSet[];
  exercise_details?: { exercise_index: number; completed: boolean; notes: string }[]; expected_revision?: string; plan_slot_id?: string; household_id?: string };
export type WorkoutLog = WorkoutPerformance & {
  id?: string; request_uuid?: string; user_id?: string; owner_id?: string; title?: string;
  template?: WorkoutTemplate; snapshot?: WorkoutTemplate; pending?: boolean; issue?: string;
};
export type WorkoutProposal = { id: string; template_id: string; snapshot?: WorkoutTemplate; template?: WorkoutTemplate; status?: string };
export type WorkoutProgress = {
  sessions_completed: number; total_volume_kg: number; total_duration_seconds: number;
  exercises: { name?: string; exercise_name?: string; sessions_completed?: number; total_volume_kg?: number; total_duration_seconds?: number; max_weight_kg?: number }[];
};
