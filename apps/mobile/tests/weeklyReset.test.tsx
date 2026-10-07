import * as Notifications from "expo-notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { WeeklyPlanningSettings } from "@/features/preferences/WeeklyPlanningSettings";
import { apiFetch } from "@/services/api";
import { clearPlanningReminders, syncGroupPlanningReminders, syncPlanningReminder } from "@/services/planningReminders";
import { WeeklyPlanningSettings as Settings } from "@/services/types";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));

const request = jest.mocked(apiFetch);
const manual: Settings = { mode: "manual", reset_day: 0, notify: true, time_zone: "UTC" };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true, canAskAgain: true } as never);
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([]);
  request.mockImplementation(async () => ({ email: "tester@example.com", weekly_planning: manual }));
});

test.each([[0, 2], [5, 7], [6, 1]])("weekday %s schedules only one recurring 9 AM notification", async (reset_day, weekday) => {
  await syncPlanningReminder("tester", { ...manual, mode: "automatic", reset_day });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    identifier: "dinner-weekly-reset", trigger: expect.objectContaining({ weekday, hour: 9, minute: 0, repeats: true })
  }));
});

test("manual-only, disabled reminders, and denied permissions never schedule", async () => {
  await syncPlanningReminder("tester", manual);
  await syncPlanningReminder("tester", { ...manual, mode: "automatic", notify: false });
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false } as never);
  await syncPlanningReminder("tester", { ...manual, mode: "automatic" });
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(3);
});

test("matching reminders are kept and logout cancels the app reminder", async () => {
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([{
    identifier: "dinner-weekly-reset", content: { data: { signature: JSON.stringify(["tester", 0]) } }
  }] as never);
  await syncPlanningReminder("tester", { ...manual, mode: "automatic" });
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  await clearPlanningReminders();
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("dinner-weekly-reset");
});

test("group reminders have distinct destinations and departed groups are cancelled", async () => {
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([{ identifier: "dinner-group-reset-departed" }] as never);
  await syncGroupPlanningReminders("tester", [
    { id: "family", name: "Family", settings: { ...manual, mode: "automatic", reset_day: 2 } },
    { id: "friends", name: "Friends", settings: { ...manual, mode: "automatic", reset_day: 6 } },
    { id: "manual", name: "Manual", settings: manual }
  ]);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ identifier: "dinner-group-reset-family", content: expect.objectContaining({ data: expect.objectContaining({ household_id: "family" }) }), trigger: expect.objectContaining({ weekday: 4 }) }));
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ identifier: "dinner-group-reset-friends", content: expect.objectContaining({ data: expect.objectContaining({ household_id: "friends" }) }) }));
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("dinner-group-reset-departed");
});

test("account settings default to manual and save the chosen reset weekday", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><WeeklyPlanningSettings /></QueryClientProvider>);
  try {
    await waitFor(() => expect(screen.getByLabelText("Automatic").props.accessibilityState.disabled).toBe(false));
    expect(screen.queryByText("Reset day")).toBeNull();
    fireEvent.press(screen.getByLabelText("Automatic"));
    fireEvent.press(screen.getByLabelText("Reset day: Monday"));
    fireEvent.press(screen.getByLabelText("Sunday"));
    expect(screen.getByLabelText("Weekly phone reminder").props.value).toBe(true);
    request.mockImplementation(async path => ({ email: "tester@example.com", weekly_planning: path.includes("planning")
      ? { ...manual, mode: "automatic", reset_day: 6 } : manual }));
    fireEvent.press(screen.getByLabelText("Save planning settings"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/profile/planning", {
      method: "PATCH", body: JSON.stringify({ ...manual, mode: "automatic", reset_day: 6, initialize_only: false })
    }));
    expect(Platform.OS).not.toBe("web");
  } finally { screen.unmount(); client.clear(); }
});
