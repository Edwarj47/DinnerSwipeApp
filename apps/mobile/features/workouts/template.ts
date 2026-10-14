import { WorkoutCategory } from "./types";

export type ExerciseDraft = { name: string; sets: string; reps: string; duration: string };
export const emptyExercise = (): ExerciseDraft => ({ name: "", sets: "", reps: "", duration: "" });
export function uploadedWorkoutPhotoReference(value: string) {
  const url = new URL(value);
  if (!/^\/api\/v1\/media\/objects\/[a-zA-Z0-9-]+$/.test(url.pathname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("The uploaded workout photo could not be saved.");
  url.search = ""; url.hash = "";
  return url.toString();
}
export function buildWorkoutTemplate(title: string, category: WorkoutCategory, description: string, exercises: ExerciseDraft[], photoReference: string | null = null) {
  if (!title.trim() || title.trim().length > 160) throw new Error("Add a workout title of up to 160 characters.");
  const rows = exercises.filter(item => Object.values(item).some(value => value.trim())).map(item => {
    if (!item.name.trim() || item.name.trim().length > 160) throw new Error("Add a name for each exercise with entered details.");
    for (const [label, value, max] of [["sets", item.sets, 100], ["duration", item.duration, 86400]] as const) {
      if (value.trim() && (!/^\d+$/.test(value.trim()) || Number(value) < 1 || Number(value) > max)) throw new Error(`Enter valid ${label}.`);
    }
    if (item.reps.trim().length > 80) throw new Error("Keep repetitions under 80 characters.");
    return { name: item.name.trim(), ...(item.sets.trim() ? { sets: Number(item.sets) } : {}), ...(item.reps.trim() ? { reps: item.reps.trim() } : {}), ...(item.duration.trim() ? { duration_seconds: Number(item.duration) } : {}) };
  });
  return { title: title.trim(), category, description: description.trim(), exercises: rows, photo_url: photoReference ? uploadedWorkoutPhotoReference(photoReference) : null };
}
