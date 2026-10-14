import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { apiFetch } from "@/services/api";
import { setOfflineOwner } from "@/services/offlineStore";
import { bindWorkoutModeClient, parseExperiencePreferences, resetWorkoutMode, restoreWorkoutPreferences, seedWorkoutPreferences, setWorkoutsEnabled, updateWorkoutPreferences, useWorkoutMode, workoutTabVisibility } from "@/services/workoutMode";
import { ExperienceSelector } from "@/features/workouts/ExperienceSelector";
import { workoutTabBarProps } from "@/features/workouts/navigation";

jest.mock("@/services/api", () => ({ ...jest.requireActual("@/services/api"), apiFetch: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: jest.requireActual("react-native").View }));
beforeEach(async () => { jest.mocked(apiFetch).mockReset(); await AsyncStorage.clear(); setOfflineOwner("a"); resetWorkoutMode("a"); bindWorkoutModeClient(null); });
afterEach(() => bindWorkoutModeClient(null));
test("flag-off experience hides the selector and keeps nutrition defaults", () => {
  expect(parseExperiencePreferences({ mode: "unknown", weight_unit: "stone" })).toEqual({ mode: "nutrition", weight_unit: "kg" });
  const screen = render(<ExperienceSelector />); expect(screen.queryByLabelText("Experience: Nutrition")).toBeNull();
  expect(workoutTabVisibility("nutrition")).toEqual({ grocery: true, recipesTitle: "Recipes" });
});
test("workout tabs remove only Grocery and retain Macros", () => {
  const routes = ["index", "week", "grocery", "recipes", "profile"].map(name => ({ name, key: name }));
  const props = { state: { routes, index: 4 } } as unknown as BottomTabBarProps;
  expect(workoutTabBarProps(props, false)).toBe(props);
  expect(workoutTabBarProps(props, true).state.routes.map(route => route.name)).toEqual(["index", "week", "recipes", "profile"]);
  expect(workoutTabBarProps(props, true).state.index).toBe(3);
  expect(workoutTabVisibility("workouts")).toEqual({ grocery: false, recipesTitle: "Workouts" });
});
test("selector saves the mode beside the existing logo control", async () => {
  setWorkoutsEnabled(true); jest.mocked(apiFetch).mockResolvedValue({ experience_preferences: { mode: "workouts", weight_unit: "kg" } });
  const screen = render(<ExperienceSelector />); fireEvent.press(screen.getByLabelText("Experience: Nutrition")); fireEvent.press(screen.getByText("Workouts"));
  await waitFor(() => expect(useWorkoutMode.getState().mode).toBe("workouts"));
  expect(apiFetch).toHaveBeenCalledWith("/api/v1/profile/experience", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ mode: "workouts", weight_unit: "kg" }) }));
});
test("preference PATCH updates the authoritative profile query cache", async () => {
  const client = new QueryClient(); bindWorkoutModeClient(client); client.setQueryData(["profile"], { name: "Kept", experience_preferences: { mode: "nutrition", weight_unit: "kg" } });
  setWorkoutsEnabled(true); jest.mocked(apiFetch).mockResolvedValue({ experience_preferences: { mode: "workouts", weight_unit: "lb" } });
  await updateWorkoutPreferences({ mode: "workouts", weight_unit: "lb" });
  expect(client.getQueryData(["profile"])).toEqual({ name: "Kept", experience_preferences: { mode: "workouts", weight_unit: "lb" } });
  client.clear();
});
test("late local restore cannot overwrite server-seeded preferences", async () => {
  await AsyncStorage.setItem("dinnerSwipe.workouts.preferences.v1.a", JSON.stringify({ mode: "nutrition", weight_unit: "kg" }));
  const restoring = restoreWorkoutPreferences("a"); seedWorkoutPreferences({ mode: "workouts", weight_unit: "lb" }); await restoring;
  expect(useWorkoutMode.getState()).toMatchObject({ mode: "workouts", weight_unit: "lb" });
});
test("account reset drops selected mode and ignores an old account's restore", async () => {
  await AsyncStorage.setItem("dinnerSwipe.workouts.preferences.v1.a", JSON.stringify({ mode: "workouts", weight_unit: "lb" }));
  const restoring = restoreWorkoutPreferences("a"); setOfflineOwner("b"); resetWorkoutMode("b"); await restoring;
  expect(useWorkoutMode.getState()).toMatchObject({ owner: "b", mode: "nutrition", weight_unit: "kg", enabled: false });
});
