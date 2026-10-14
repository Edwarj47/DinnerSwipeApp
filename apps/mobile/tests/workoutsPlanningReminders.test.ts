import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { PermissionStatus } from "expo-modules-core";
import { Platform } from "react-native";
import { clearAuthTokens } from "@/services/api";
import { setOfflineOwner } from "@/services/offlineStore";
import {
  clearPlanningReminders,
  clearWorkoutPlanningReminders,
  syncGroupPlanningReminders,
  syncPlanningReminder,
  syncWorkoutPlanningReminders
} from "@/services/planningReminders";
import type { WeeklyPlanningSettings } from "@/services/types";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined)
}));

const owner = "workout-owner";
const automatic: WeeklyPlanningSettings = {
  mode: "automatic", reset_day: 0, notify: true, time_zone: "UTC"
};
const manual: WeeklyPlanningSettings = { ...automatic, mode: "manual" };
const scheduled = new Map<string, Notifications.NotificationRequest>();
const schedule = jest.mocked(Notifications.scheduleNotificationAsync);
const cancel = jest.mocked(Notifications.cancelScheduledNotificationAsync);
const inventory = jest.mocked(Notifications.getAllScheduledNotificationsAsync);
const permissions = jest.mocked(Notifications.getPermissionsAsync);

function notification(
  identifier: string, content: Notifications.NotificationContentInput = {}
): Notifications.NotificationRequest {
  return {
    identifier,
    content: {
      title: content.title ?? null, subtitle: content.subtitle ?? null,
      body: content.body ?? null, data: content.data ?? {}, sound: null,
      launchImageName: null, badge: null, attachments: [],
      categoryIdentifier: null, threadIdentifier: null
    },
    trigger: {
      type: "calendar", repeats: true,
      dateComponents: { weekday: 2, hour: 9, minute: 0, isLeapMonth: false }
    }
  };
}

function seed(...identifiers: string[]) {
  for (const identifier of identifiers) scheduled.set(identifier, notification(identifier));
}

beforeEach(() => {
  jest.clearAllMocks();
  scheduled.clear();
  setOfflineOwner(null);
  jest.replaceProperty(Platform, "OS", "ios");
  jest.spyOn(global, "fetch").mockRejectedValue(new Error("Unexpected network request"));
  permissions.mockResolvedValue({
    granted: true, canAskAgain: true, expires: "never", status: PermissionStatus.GRANTED
  });
  inventory.mockImplementation(async () => [...scheduled.values()]);
  cancel.mockImplementation(async identifier => { scheduled.delete(identifier); });
  schedule.mockImplementation(async request => {
    if (!request.identifier) throw new Error("Missing notification identifier");
    scheduled.set(request.identifier, notification(request.identifier, request.content));
    return request.identifier;
  });
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

test.each(["ios", "android"] as const)(
  "%s workout reminders have distinct personal/group IDs and preserve meal schedules", async platform => {
    jest.replaceProperty(Platform, "OS", platform);
    seed("dinner-weekly-reset", "dinner-group-reset-team", "calendar-appointment");
    const mealPersonal = scheduled.get("dinner-weekly-reset");
    const mealGroup = scheduled.get("dinner-group-reset-team");
    await syncWorkoutPlanningReminders(owner, automatic, [
      { id: "team", name: "Training team", settings: { ...automatic, reset_day: 2 } },
      { id: "friends", name: "Friends", settings: { ...automatic, reset_day: 6 } }
    ]);
    expect(schedule).toHaveBeenCalledTimes(3);
    expect(schedule.mock.calls.map(([request]) => request.identifier)).toEqual([
      "dinner-workout-reset", "dinner-workout-group-reset-team", "dinner-workout-group-reset-friends"
    ]);
    expect(schedule).toHaveBeenCalledWith({
      identifier: "dinner-workout-reset",
      content: {
        title: "Time to plan your workouts", body: "Open This Week to choose your workouts for the week.",
        data: { route: "/week", signature: JSON.stringify([owner, 0]), experience: "workouts" }
      },
      trigger: { weekday: 2, hour: 9, minute: 0, repeats: true, channelId: "weekly-planning" }
    });
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      identifier: "dinner-workout-group-reset-team",
      content: expect.objectContaining({
        title: "Plan workouts for Training team",
        data: { route: "/week", signature: JSON.stringify([owner, 2]), experience: "workouts", household_id: "team" }
      }),
      trigger: expect.objectContaining({ weekday: 4, hour: 9, minute: 0, repeats: true })
    }));
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      identifier: "dinner-workout-group-reset-friends",
      content: expect.objectContaining({
        data: { route: "/week", signature: JSON.stringify([owner, 6]), experience: "workouts", household_id: "friends" }
      }),
      trigger: expect.objectContaining({ weekday: 1 })
    }));
    expect(scheduled.get("dinner-weekly-reset")).toBe(mealPersonal);
    expect(scheduled.get("dinner-group-reset-team")).toBe(mealGroup);
    expect(scheduled.has("calendar-appointment")).toBe(true);
    expect(cancel.mock.calls.every(([identifier]) => identifier.startsWith("dinner-workout-"))).toBe(true);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  }
);

test("manual workout planning cancels existing personal/group reminders and schedules none", async () => {
  await syncWorkoutPlanningReminders(owner, automatic, [
    { id: "team", name: "Team", settings: automatic }
  ]);
  seed("dinner-weekly-reset", "dinner-group-reset-team");
  jest.clearAllMocks();
  await syncWorkoutPlanningReminders(owner, manual, [{ id: "team", name: "Team", settings: manual }]);
  expect(schedule).not.toHaveBeenCalled();
  expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  expect(cancel.mock.calls.map(([identifier]) => identifier)).toEqual([
    "dinner-workout-reset", "dinner-workout-group-reset-team"
  ]);
  expect([...scheduled.keys()].sort()).toEqual(["dinner-group-reset-team", "dinner-weekly-reset"]);
});

test.each(["notifications disabled", "permission denied"])("%s prevents workout scheduling", async reason => {
  seed("dinner-workout-reset", "dinner-workout-group-reset-team", "dinner-weekly-reset");
  const settings = { ...automatic, notify: reason !== "notifications disabled" };
  if (reason === "permission denied") {
    permissions.mockResolvedValue({
      granted: false, canAskAgain: false, expires: "never", status: PermissionStatus.DENIED
    });
  }
  await syncWorkoutPlanningReminders(owner, settings, [{ id: "team", name: "Team", settings }]);
  expect(schedule).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect([...scheduled.keys()]).toEqual(["dinner-weekly-reset"]);
});

test("departed workout groups are cancelled without touching meal or active group reminders", async () => {
  seed("dinner-workout-group-reset-departed", "dinner-workout-group-reset-old",
    "dinner-group-reset-departed", "dinner-weekly-reset", "calendar-appointment");
  const active = notification("dinner-workout-group-reset-active", {
    data: { signature: JSON.stringify([owner, 0]), experience: "workouts", household_id: "active" }
  });
  scheduled.set(active.identifier, active);
  await syncWorkoutPlanningReminders(owner, manual, [{ id: "active", name: "Active", settings: automatic }]);
  expect(cancel.mock.calls.map(([identifier]) => identifier).sort()).toEqual([
    "dinner-workout-group-reset-departed", "dinner-workout-group-reset-old", "dinner-workout-reset"
  ]);
  expect(schedule).not.toHaveBeenCalled();
  expect(scheduled.get(active.identifier)).toBe(active);
  expect([...scheduled.keys()].sort()).toEqual([
    "calendar-appointment", "dinner-group-reset-departed", "dinner-weekly-reset", active.identifier
  ].sort());
});

test("an empty workout group inventory cancels all departed workout groups", async () => {
  seed("dinner-workout-group-reset-a", "dinner-workout-group-reset-b",
    "dinner-group-reset-a", "dinner-weekly-reset");
  await syncWorkoutPlanningReminders(owner, manual, []);
  expect(schedule).not.toHaveBeenCalled();
  expect([...scheduled.keys()].sort()).toEqual(["dinner-group-reset-a", "dinner-weekly-reset"]);
});

test("matching workout reminders are idempotent and a changed reset day replaces only its scope", async () => {
  const groups = [{ id: "team", name: "Team", settings: automatic }];
  await syncWorkoutPlanningReminders(owner, automatic, groups);
  jest.clearAllMocks();
  await syncWorkoutPlanningReminders(owner, automatic, groups);
  expect(cancel).not.toHaveBeenCalled();
  expect(schedule).not.toHaveBeenCalled();
  await syncWorkoutPlanningReminders(owner, { ...automatic, reset_day: 6 }, groups);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledWith("dinner-workout-reset");
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
    identifier: "dinner-workout-reset",
    content: expect.objectContaining({ data: expect.objectContaining({ signature: JSON.stringify([owner, 6]) }) }),
    trigger: expect.objectContaining({ weekday: 1 })
  }));
});

test("an account change replaces workout reminder signatures rather than reusing the old owner", async () => {
  const groups = [{ id: "team", name: "Team", settings: automatic }];
  await syncWorkoutPlanningReminders(owner, automatic, groups);
  jest.clearAllMocks();
  await syncWorkoutPlanningReminders("new-owner", automatic, groups);
  expect(schedule).toHaveBeenCalledTimes(2);
  for (const [request] of schedule.mock.calls) {
    expect(request.content.data?.signature).toBe(JSON.stringify(["new-owner", 0]));
  }
});

test("meal synchronization keeps workout IDs and the existing meal notification payload", async () => {
  await syncWorkoutPlanningReminders(owner, automatic, [{ id: "team", name: "Team", settings: automatic }]);
  const workoutPersonal = scheduled.get("dinner-workout-reset");
  const workoutGroup = scheduled.get("dinner-workout-group-reset-team");
  seed("dinner-group-reset-departed");
  jest.clearAllMocks();
  await syncPlanningReminder(owner, automatic);
  await syncGroupPlanningReminders(owner, [{ id: "team", name: "Meal team", settings: automatic }]);
  expect(schedule.mock.calls.map(([request]) => request.identifier)).toEqual([
    "dinner-weekly-reset", "dinner-group-reset-team"
  ]);
  for (const [request] of schedule.mock.calls) {
    expect(request.content.data?.route).toBe("/week");
    expect(request.content.data).not.toHaveProperty("experience");
  }
  expect(cancel).toHaveBeenCalledWith("dinner-group-reset-departed");
  expect(cancel.mock.calls.some(([identifier]) => identifier.startsWith("dinner-workout-"))).toBe(false);
  expect(scheduled.get("dinner-workout-reset")).toBe(workoutPersonal);
  expect(scheduled.get("dinner-workout-group-reset-team")).toBe(workoutGroup);
});

test.each(["clearPlanningReminders", "logout"])("%s clears both meal/workout scopes but not unrelated notifications", async action => {
  seed("dinner-weekly-reset", "dinner-group-reset-a", "dinner-group-reset-b",
    "dinner-workout-reset", "dinner-workout-group-reset-a", "dinner-workout-group-reset-b",
    "calendar-appointment");
  if (action === "logout") await clearAuthTokens();
  else await clearPlanningReminders();
  expect(cancel.mock.calls.map(([identifier]) => identifier).sort()).toEqual([
    "dinner-weekly-reset", "dinner-group-reset-a", "dinner-group-reset-b",
    "dinner-workout-reset", "dinner-workout-group-reset-a", "dinner-workout-group-reset-b"
  ].sort());
  expect([...scheduled.keys()]).toEqual(["calendar-appointment"]);
  expect(schedule).not.toHaveBeenCalled();
  if (action === "logout") {
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("dinnerSwipeAccessToken");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("dinnerSwipeRefreshToken");
  }
});

test.each(["ios", "android"] as const)("%s workout-only cleanup preserves meal and unrelated reminders", async platform => {
  jest.replaceProperty(Platform, "OS", platform);
  seed("dinner-weekly-reset", "dinner-group-reset-a", "dinner-group-reset-b",
    "dinner-workout-reset", "dinner-workout-group-reset-a", "dinner-workout-group-reset-b",
    "calendar-appointment", "dinner-workout-digest");
  const meals = [scheduled.get("dinner-weekly-reset"), scheduled.get("dinner-group-reset-a"),
    scheduled.get("dinner-group-reset-b")];
  await clearWorkoutPlanningReminders();
  expect(cancel.mock.calls.map(([identifier]) => identifier).sort()).toEqual([
    "dinner-workout-reset", "dinner-workout-group-reset-a", "dinner-workout-group-reset-b"
  ].sort());
  expect([...scheduled.keys()].sort()).toEqual([
    "dinner-weekly-reset", "dinner-group-reset-a", "dinner-group-reset-b",
    "calendar-appointment", "dinner-workout-digest"
  ].sort());
  expect([scheduled.get("dinner-weekly-reset"), scheduled.get("dinner-group-reset-a"),
    scheduled.get("dinner-group-reset-b")]).toEqual(meals);
  expect(schedule).not.toHaveBeenCalled();
  expect(permissions).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test("workout-only cleanup is safe to repeat without disturbing meal schedules", async () => {
  seed("dinner-weekly-reset", "dinner-group-reset-team", "dinner-workout-reset",
    "dinner-workout-group-reset-team");
  await clearWorkoutPlanningReminders();
  jest.clearAllMocks();
  await clearWorkoutPlanningReminders();
  expect([...scheduled.keys()].sort()).toEqual(["dinner-group-reset-team", "dinner-weekly-reset"]);
  expect(cancel.mock.calls.every(([identifier]) => identifier.startsWith("dinner-workout-"))).toBe(true);
  expect(schedule).not.toHaveBeenCalled();
});

test("workout-only cleanup is a native no-op on web", async () => {
  jest.replaceProperty(Platform, "OS", "web");
  seed("dinner-weekly-reset", "dinner-workout-reset", "dinner-workout-group-reset-team");
  await clearWorkoutPlanningReminders();
  expect([...scheduled.keys()]).toEqual([
    "dinner-weekly-reset", "dinner-workout-reset", "dinner-workout-group-reset-team"
  ]);
  expect(inventory).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  expect(schedule).not.toHaveBeenCalled();
});

test("workout-only cleanup queued during a batch removes that batch without cancelling meals", async () => {
  seed("dinner-weekly-reset", "dinner-group-reset-team", "calendar-appointment");
  let releaseInventory!: (items: Notifications.NotificationRequest[]) => void;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const pendingInventory = new Promise<Notifications.NotificationRequest[]>(resolve => { releaseInventory = resolve; });
  inventory.mockImplementationOnce(() => { markStarted(); return pendingInventory; });
  const syncing = syncWorkoutPlanningReminders(owner, automatic, [{ id: "team", name: "Team", settings: automatic }]);
  await started;
  const clearing = clearWorkoutPlanningReminders();
  releaseInventory([...scheduled.values()]);
  await Promise.all([syncing, clearing]);
  expect([...scheduled.keys()].sort()).toEqual([
    "calendar-appointment", "dinner-group-reset-team", "dinner-weekly-reset"
  ]);
  expect(schedule).toHaveBeenCalledTimes(2);
  expect(cancel.mock.calls.every(([identifier]) => identifier.startsWith("dinner-workout-"))).toBe(true);
});

test("logout cleanup does not allow an already-started workout sync to recreate reminders", async () => {
  let releaseInventory!: (items: Notifications.NotificationRequest[]) => void;
  const pendingInventory = new Promise<Notifications.NotificationRequest[]>(resolve => { releaseInventory = resolve; });
  inventory.mockImplementationOnce(() => pendingInventory);
  const syncing = syncWorkoutPlanningReminders(owner, automatic, [{ id: "team", name: "Team", settings: automatic }]);
  await Promise.resolve();
  expect(inventory).toHaveBeenCalledTimes(1);
  const clearing = clearPlanningReminders();
  releaseInventory([]);
  await Promise.all([syncing, clearing]);
  expect([...scheduled.keys()]).toEqual([]);
});
