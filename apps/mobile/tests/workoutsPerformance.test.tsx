import { buildPerformance, initialPerformance, performanceFromLog } from "@/features/workouts/performance";
import { WorkoutTemplate } from "@/features/workouts/types";
import { displayWorkoutWeight, weightInKg } from "@/services/workoutMode";

const template: WorkoutTemplate = { id: "routine", owner_id: "a", title: "Leg day", category: "lower", exercises: [{ name: "Squat", sets: 2, reps: "8-10" }, { name: "Bike", duration_seconds: 120 }] };
const today = "2026-10-14";
test("prescribed exercise metrics do not become actual performance", () => {
  const form = initialPerformance(template);
  expect(form[0].sets).toHaveLength(2);
  expect(form.flatMap(item => item.sets)).toEqual(Array(3).fill({ reps: "", weightKg: "", duration: "" }));
  expect(() => buildPerformance(template, today, true, "", form, today)).toThrow(/actual set/);
});
test("full actual performance includes canonical kg and exercise completion/notes", () => {
  const form = initialPerformance(template);
  form[0].sets[0] = { reps: "8", weightKg: String(weightInKg(132.277357308, "lb")), duration: "45" };
  form[0].notes = "Controlled tempo\nNo pain"; form[0].completed = true;
  form[1].sets[0].duration = "120";
  const result = buildPerformance(template, today, true, "Good session", form, today);
  expect(result.sets[0].weight_kg).toBeCloseTo(60);
  expect(result.sets[0]).toMatchObject({ reps: 8, duration_seconds: 45 });
  expect(result.sets[1]).toEqual({ exercise_index: 1, set_number: 1, duration_seconds: 120 });
  expect(result.notes).toBe("Good session");
  expect(result.exercise_details).toEqual([{ exercise_index: 0, completed: true, notes: "Controlled tempo\nNo pain" },
    { exercise_index: 1, completed: false, notes: "" }]);
  const restored = performanceFromLog(template, { ...result, snapshot: template });
  expect(restored.notes).toBe("Good session"); expect(restored.exercises[0].notes).toBe("Controlled tempo\nNo pain");
  expect(restored.exercises[0].completed).toBe(true); expect(restored.exercises[1].completed).toBe(false);
});
test.each(["-5", "NaN", "Infinity", "1e3", "2.2"])("rejects invalid actual reps %s", reps => {
  const form = initialPerformance(template); form[0].sets[0].reps = reps;
  expect(() => buildPerformance(template, today, false, "", form, today)).toThrow(/repetitions/);
});
test("rejects future dates and weighted duration-only sets", () => {
  const form = initialPerformance(template); form[0].sets[0].duration = "30"; form[0].sets[0].weightKg = "20";
  expect(() => buildPerformance(template, "2026-10-15", true, "", form, today)).toThrow(/date/);
  expect(() => buildPerformance(template, today, true, "", form, today)).toThrow(/Weighted sets/);
});
test("switching display units does not change the canonical weight", () => {
  const canonical = weightInKg(100, "lb");
  expect(displayWorkoutWeight(canonical, "lb")).toBe("100");
  expect(displayWorkoutWeight(canonical, "kg")).toBe("45.36");
});
