import { WorkoutLog, WorkoutPerformance, WorkoutTemplate } from "./types";

export type ActualSet = { reps: string; weightKg: string; duration: string };
export type ExercisePerformance = { sets: ActualSet[]; notes: string; completed: boolean };
export const emptyActualSet = (): ActualSet => ({ reps: "", weightKg: "", duration: "" });
export function initialPerformance(template: WorkoutTemplate): ExercisePerformance[] {
  return template.exercises.map(exercise => ({ sets: Array.from({ length: Math.min(20, Math.max(1, exercise.sets ?? 1)) }, emptyActualSet), notes: "", completed: false }));
}
const DETAIL_MARKER = "[Exercise details]\n";
export function performanceFromLog(template: WorkoutTemplate, log: WorkoutLog) {
  const exercises = initialPerformance(template);
  for (let i = 0; i < exercises.length; i++) {
    const rows = log.sets.filter(row => row.exercise_index === i);
    const count = Math.min(100, Math.max(1, ...rows.map(row => row.set_number)));
    exercises[i].sets = Array.from({ length: count }, (_, n) => {
      const row = rows.find(row => row.set_number === n + 1);
      return { reps: row?.reps?.toString() ?? "", weightKg: row?.weight_kg?.toString() ?? "", duration: row?.duration_seconds?.toString() ?? "" };
    });
    exercises[i].completed = log.completed;
  }
  const notes = log.notes ?? "", marker = notes.lastIndexOf(DETAIL_MARKER);
  if (log.exercise_details) {
    for (const detail of log.exercise_details) {
      if (!exercises[detail.exercise_index]) continue;
      exercises[detail.exercise_index].notes = detail.notes;
      exercises[detail.exercise_index].completed = detail.completed;
    }
    return { notes, exercises };
  }
  if (marker < 0) return { notes, exercises };
  const lines = notes.slice(marker + DETAIL_MARKER.length).split("\n");
  let cursor = 0;
  template.exercises.forEach((exercise, i) => {
    const prefix = `${exercise.name}: `, header = lines[cursor] ?? "";
    if (!header.startsWith(prefix)) return;
    const detail = header.slice(prefix.length);
    exercises[i].completed = detail.startsWith("completed");
    const body = [detail.replace(/^(?:completed|incomplete)(?: - )?/, "")];
    cursor++;
    const next = template.exercises[i + 1]?.name;
    while (cursor < lines.length && (!next || !lines[cursor].startsWith(`${next}: `))) body.push(lines[cursor++]);
    exercises[i].notes = body.join("\n").trim();
  });
  return { notes: notes.slice(0, marker).trim(), exercises };
}
function metric(text: string, label: string, integer = false, allowZero = false) {
  if (!text.trim()) return undefined;
  const value = Number(text);
  if (!/^\d+(?:\.\d+)?$/.test(text.trim()) || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0) || (integer && !Number.isInteger(value))) throw new Error(`Enter a valid ${label}.`);
  if (value > (label === "weight" ? 2000 : label === "repetitions" ? 10000 : 86400)) throw new Error(`${label} is too large.`);
  return value;
}
export function buildPerformance(template: WorkoutTemplate, performedOn: string, completed: boolean, notes: string, exercises: ExercisePerformance[], today: string): WorkoutPerformance {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(performedOn) || !Number.isFinite(Date.parse(performedOn)) || new Date(`${performedOn}T12:00:00Z`).toISOString().slice(0, 10) !== performedOn || performedOn > today) throw new Error("Choose a valid session date, no later than today.");
  if (exercises.length !== template.exercises.length) throw new Error("The workout exercises changed. Reopen the session.");
  const sets = exercises.flatMap((exercise, exercise_index) => exercise.sets.flatMap((row, index) => {
    if (!row.reps.trim() && !row.weightKg.trim() && !row.duration.trim()) return [];
    const reps = metric(row.reps, "repetitions", true), weight = metric(row.weightKg, "weight", false, true), duration = metric(row.duration, "duration", true);
    if (reps === undefined && duration === undefined) throw new Error("Add repetitions or duration to each recorded set.");
    if (weight !== undefined && reps === undefined) throw new Error("Weighted sets require repetitions.");
    return [{ exercise_index, set_number: index + 1, ...(reps !== undefined ? { reps } : {}), ...(weight !== undefined ? { weight_kg: weight } : {}), ...(duration !== undefined ? { duration_seconds: duration } : {}) }];
  }));
  if (!sets.length && template.exercises.length) throw new Error("Record at least one actual set before saving.");
  if (sets.length > 200) throw new Error("A session can have at most 200 recorded sets.");
  if (notes.trim().length > 4000 || exercises.some(exercise => exercise.notes.trim().length > 1000)) throw new Error("Keep session notes under 4,000 characters and exercise notes under 1,000.");
  return { template_id: template.id, performed_on: performedOn, completed, notes: notes.trim(), sets,
    exercise_details: exercises.map((exercise, exercise_index) => ({ exercise_index, completed: exercise.completed, notes: exercise.notes.trim() })),
    ...(template.revision ? { expected_revision: template.revision } : {}) };
}
