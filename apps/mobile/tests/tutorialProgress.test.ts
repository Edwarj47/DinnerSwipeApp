import { parseTutorialProgress, tutorialEvidence } from "@/services/tutorialProgress";
import { taskStepsFor } from "@/features/onboarding/tourSteps";

test("walkthroughs use real routes and the task's actual completion event", () => {
  expect(taskStepsFor("meals", "2026-11-17").map(step => step.path)).toEqual(["/", "/week", "/grocery"]);
  expect(taskStepsFor("workouts", "2026-11-17").every(step => step.path === "/recipes")).toBe(true);
  expect(taskStepsFor("macros", "2026-11-17")[0].params).toMatchObject({ macro_date: "2026-11-17", section: "tracking" });
});
test("favorites, proposals, optimistic state and failures are not a planned meal", () => {
  expect(tutorialEvidence("u", "/api/v1/recipes/swipes", "POST", { action: "favorite" }, { planned_slot_id: "slot" })).toBeNull();
  expect(tutorialEvidence("u", "/api/v1/recipes/swipes", "POST", { action: "add", household_id: "g" }, { status: "recorded", planned_slot_id: "" })).toBeNull();
  expect(tutorialEvidence("u", "/api/v1/recipes/swipes", "POST", { action: "add" }, { planned_slot_id: "slot" })).toEqual({ owner: "u", action: "meal-planned", scope: "personal", id: "slot" });
});
test("scheduling and grocery evidence are scoped and based on persisted results", () => {
  expect(tutorialEvidence("u", "/api/v1/households/g/weekly-plans/current/slots/s", "PUT", { slot_date: "2026-11-18" }, { slots: [{ id: "s", recipe_id: "r", slot_date: "2026-11-18" }] })).toMatchObject({ scope: "g", id: "s", action: "meal-scheduled" });
  expect(tutorialEvidence("u", "/api/v1/grocery-lists/current/regenerate", "POST", {}, { id: "list" })).toMatchObject({ scope: "personal", action: "groceries-built" });
  expect(tutorialEvidence("u", "/api/v1/grocery-lists/current", "GET", {}, { id: "list" })).toBeNull();
});
test("only new confirmed macro entries count, including offline sync acknowledgements", () => {
  const entry = { id: "entry", status: "ate", meal_date: "2026-11-17", calories: null };
  expect(tutorialEvidence("u", "/api/v1/macros/entries", "POST", {}, entry)).toMatchObject({ action: "macro-logged", scope: "personal", date: "2026-11-17" });
  expect(tutorialEvidence("u", "/api/v1/macros/entries/entry", "PUT", {}, entry)).toBeNull();
  expect(tutorialEvidence("u", "/api/v1/offline/sync", "POST", { kind: "macro_create", values: {} }, { result: entry })).toMatchObject({ action: "macro-logged" });
  expect(tutorialEvidence("u", "/api/v1/macros/entries", "POST", {}, { status: "saved_on_device" })).toBeNull();
});
test("no-set workout sessions can complete the logging action", () => {
  expect(tutorialEvidence("u", "/api/v1/workouts/logs/request", "PUT", { sets: [] }, { request_uuid: "request" })).toMatchObject({ action: "workout-logged", id: "request" });
});
test("calculator completion counts only a confirmed new daily entry", () => {
  expect(tutorialEvidence("u", "/api/v1/nutrition/calculations", "POST", { destination: "entry" }, { entry_id: "e" })).toMatchObject({ action: "macro-logged", id: "e", scope: "personal" });
  expect(tutorialEvidence("u", "/api/v1/nutrition/calculations", "POST", { destination: "recipe" }, { recipe_id: "r" })).toBeNull();
  expect(tutorialEvidence("u", "/api/v1/nutrition/calculations", "POST", { destination: "entry" }, {})).toBeNull();
  expect(tutorialEvidence("u", "/api/v1/nutrition/calculations/c", "PUT", {}, { entry_id: "e" })).toBeNull();
});
test("resume data is bounded and excludes meal descriptions and provider data", () => {
  const input = { version: 1, task: "meals", index: 1, scope: "personal", completed: ["meal-plan"], skipped: [], status: "paused", rawMeal: "private meal", audio: "private audio" };
  expect(parseTutorialProgress(input)).toEqual({ version: 1, task: "meals", index: 1, scope: "personal", completed: ["meal-plan"], skipped: [], status: "paused" });
  expect(parseTutorialProgress({ ...input, index: 999 })).toBeNull();
  expect(parseTutorialProgress({ ...input, version: 9 })).toBeNull();
  expect(parseTutorialProgress(null)).toBeNull();
});
