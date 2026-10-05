import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { WeeklyPlanningSettings } from "@/services/types";

const IDENTIFIER = "dinner-weekly-reset";
const CHANNEL = "weekly-planning";

let operations = Promise.resolve();

function serialized(operation: () => Promise<void>) {
  const result = operations.then(operation, operation);
  operations = result.catch(() => undefined);
  return result;
}

export function clearPlanningReminders() {
  if (Platform.OS === "web") return Promise.resolve();
  return serialized(async () => {
    await Notifications.cancelScheduledNotificationAsync(IDENTIFIER);
  });
}

export async function requestPlanningNotificationPermission() {
  if (Platform.OS === "web") return false;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "Weekly planning", importance: Notifications.AndroidImportance.DEFAULT
  });
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export function syncPlanningReminder(owner: string, settings: WeeklyPlanningSettings) {
  if (Platform.OS === "web") return Promise.resolve();
  return serialized(async () => {
    const permission = await Notifications.getPermissionsAsync();
    const enabled = settings.mode === "automatic" && settings.notify && permission.granted;
    const signature = JSON.stringify([owner, settings.reset_day]);
    const scheduled = (await Notifications.getAllScheduledNotificationsAsync())
      .find(item => item.identifier === IDENTIFIER);
    if (enabled && scheduled?.content.data?.signature === signature) return;
    await Notifications.cancelScheduledNotificationAsync(IDENTIFIER);
    if (!enabled) return;
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Weekly planning", importance: Notifications.AndroidImportance.DEFAULT
    });
    await Notifications.scheduleNotificationAsync({
      identifier: IDENTIFIER,
      content: {
        title: "Time to plan your meals",
        body: "Open This Week to choose your meals for the week.",
        data: { route: "/week", signature }
      },
      // Expo numbers weekdays Sunday=1. Delivery follows the phone's local clock/DST.
      trigger: { weekday: ((settings.reset_day + 1) % 7) + 1, hour: 9, minute: 0,
        repeats: true, channelId: CHANNEL }
    });
  });
}
