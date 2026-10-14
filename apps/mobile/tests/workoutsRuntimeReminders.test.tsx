import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react-native";
import { WorkoutRuntime } from "@/features/workouts/WorkoutRuntime";
import { workoutKey } from "@/features/workouts/api";
import { workoutRead } from "@/features/workouts/storage";
import { ApiError, apiFetch, ConnectionError } from "@/services/api";
import { setDeviceOffline, setOfflineOwner } from "@/services/offlineStore";
import { clearPlanningReminders, clearWorkoutPlanningReminders, syncWorkoutPlanningReminders } from "@/services/planningReminders";
import { resetWorkoutMode } from "@/services/workoutMode";

jest.mock("@/services/session", () => ({ useAuthSession: () => ({ email: "workout@example.invalid" }) }));
jest.mock("@/services/api", () => ({ ...jest.requireActual("@/services/api"), apiFetch: jest.fn() }));
jest.mock("@/services/planningReminders", () => ({
  clearPlanningReminders: jest.fn(async () => undefined),
  clearWorkoutPlanningReminders: jest.fn(async () => undefined),
  syncWorkoutPlanningReminders: jest.fn(async () => undefined)
}));
jest.mock("@/features/workouts/storage", () => ({
  workoutRead: jest.fn(),
  restoreWorkoutQueue: jest.fn(async () => undefined),
  syncWorkoutPerformance: jest.fn(async () => undefined),
  useWorkoutQueue: { getState: () => ({ pending: [] }), setState: jest.fn() }
}));

const owner = "runtime-workout-owner";
const read = jest.mocked(workoutRead);
const clearWorkouts = jest.mocked(clearWorkoutPlanningReminders);
const reminders = {
  personal: { mode: "automatic" as const, reset_day: 0, notify: true, time_zone: "UTC" },
  groups: [{ id: "team", name: "Team", settings: { mode: "automatic" as const, reset_day: 2, notify: true, time_zone: "UTC" } }]
};

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } }
  });
  const screen = render(<QueryClientProvider client={client}><WorkoutRuntime /></QueryClientProvider>);
  return { client, close: () => { screen.unmount(); client.clear(); } };
}

beforeEach(async () => {
  jest.clearAllMocks();
  read.mockReset();
  await AsyncStorage.clear();
  setOfflineOwner(owner);
  setDeviceOffline(false);
  resetWorkoutMode(owner);
  jest.mocked(apiFetch).mockResolvedValue({ experience_preferences: { mode: "workouts", weight_unit: "kg" } });
  jest.spyOn(global, "fetch").mockRejectedValue(new Error("Unexpected network request"));
});

afterEach(() => {
  expect(clearPlanningReminders).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  setOfflineOwner(null);
  resetWorkoutMode(null);
  jest.restoreAllMocks();
});

test("authoritative disabled status clears only workout reminders", async () => {
  read.mockResolvedValue({ enabled: false });
  const screen = mount();
  try {
    await waitFor(() => expect(clearWorkouts).toHaveBeenCalledTimes(1));
    expect(read).toHaveBeenCalledWith("/api/v1/workouts/status");
    expect(syncWorkoutPlanningReminders).not.toHaveBeenCalled();
  } finally { screen.close(); }
});

test.each([401, 402, 403, 404])("authoritative access denial %s clears only workout reminders", async status => {
  read.mockRejectedValue(new ApiError("Workouts unavailable", status));
  const screen = mount();
  try {
    await waitFor(() => expect(clearWorkouts).toHaveBeenCalledTimes(1));
    expect(syncWorkoutPlanningReminders).not.toHaveBeenCalled();
  } finally { screen.close(); }
});

test.each([
  ["network failure", new ConnectionError("Offline")],
  ["server error", new ApiError("Server unavailable", 503)]
])("transient %s does not delete reminder schedules", async (_label, error) => {
  read.mockRejectedValue(error);
  const screen = mount();
  try {
    await waitFor(() => expect(screen.client.getQueryState(workoutKey(owner, "status"))?.status).toBe("error"));
    expect(clearWorkouts).not.toHaveBeenCalled();
    expect(syncWorkoutPlanningReminders).not.toHaveBeenCalled();
  } finally { screen.close(); }
});

test("loading status preserves reminders until a disabled response arrives", async () => {
  let resolveStatus!: (value: { enabled: boolean }) => void;
  const pending = new Promise<{ enabled: boolean }>(resolve => { resolveStatus = resolve; });
  read.mockReturnValue(pending);
  const screen = mount();
  try {
    await waitFor(() => expect(screen.client.getQueryState(workoutKey(owner, "status"))?.fetchStatus).toBe("fetching"));
    expect(clearWorkouts).not.toHaveBeenCalled();
    await act(async () => { resolveStatus({ enabled: false }); await pending; });
    await waitFor(() => expect(clearWorkouts).toHaveBeenCalledTimes(1));
  } finally { screen.close(); }
});

test("an enabled status syncs workout scopes without clearing meal or workout schedules", async () => {
  read.mockImplementation(async path => {
    if (path === "/api/v1/workouts/status") return { enabled: true };
    if (path === "/api/v1/workouts/planning-reminders") return reminders;
    throw new Error(`Unexpected workout request: ${path}`);
  });
  const screen = mount();
  try {
    await waitFor(() => expect(syncWorkoutPlanningReminders).toHaveBeenCalledWith(
      "workout@example.invalid", reminders.personal, reminders.groups
    ));
    expect(clearWorkouts).not.toHaveBeenCalled();
  } finally { screen.close(); }
});
