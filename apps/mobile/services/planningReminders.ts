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
    await Notifications.cancelScheduledNotificationAsync("dinner-workout-reset");
    for (const item of await Notifications.getAllScheduledNotificationsAsync()) {
      if (item.identifier.startsWith("dinner-group-reset-") || item.identifier.startsWith("dinner-workout-group-reset-")) await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
  });
}

export function clearWorkoutPlanningReminders() {
  if (Platform.OS === "web") return Promise.resolve();
  return serialized(async () => {
    await Notifications.cancelScheduledNotificationAsync("dinner-workout-reset");
    for (const item of await Notifications.getAllScheduledNotificationsAsync()) {
      if (item.identifier.startsWith("dinner-workout-group-reset-")) await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
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

async function applyPlanningReminder(owner: string, settings: WeeklyPlanningSettings, group?: { id: string; name: string }, experience: "meals" | "workouts" = "meals") {
  const permission = await Notifications.getPermissionsAsync();
  const enabled = settings.mode === "automatic" && settings.notify && permission.granted;
  const signature = JSON.stringify([owner, settings.reset_day]);
  const identifier = experience === "workouts" ? group ? `dinner-workout-group-reset-${group.id}` : "dinner-workout-reset" : group ? `dinner-group-reset-${group.id}` : IDENTIFIER;
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync())
    .find(item => item.identifier === identifier);
  if (enabled && scheduled?.content.data?.signature === signature) return;
  await Notifications.cancelScheduledNotificationAsync(identifier);
  if (!enabled) return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "Weekly planning", importance: Notifications.AndroidImportance.DEFAULT
  });
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: group ? `Plan ${experience} for ${group.name}` : `Time to plan your ${experience}`,
      body: `Open This Week to choose your ${experience} for the week.`,
      data: { route: "/week", signature, ...(experience === "workouts" ? { experience: "workouts" } : {}), ...(group ? { household_id: group.id } : {}) }
    },
    // Expo numbers weekdays Sunday=1. Delivery follows the phone's local clock/DST.
    trigger: { weekday: ((settings.reset_day + 1) % 7) + 1, hour: 9, minute: 0,
      repeats: true, channelId: CHANNEL }
  });
}

export function syncPlanningReminder(owner: string, settings: WeeklyPlanningSettings, group?: { id: string; name: string }, experience: "meals" | "workouts" = "meals") {
  if (Platform.OS === "web") return Promise.resolve();
  return serialized(() => applyPlanningReminder(owner, settings, group, experience));
}

export async function syncWorkoutPlanningReminders(owner: string, personal: WeeklyPlanningSettings,
  groups: { id: string; name: string; settings: WeeklyPlanningSettings }[]) {
  if (Platform.OS === "web") return;
  const identifiers = new Set(groups.map(group => `dinner-workout-group-reset-${group.id}`));
  return serialized(async () => {
    for (const item of await Notifications.getAllScheduledNotificationsAsync()) {
      if (item.identifier.startsWith("dinner-workout-group-reset-") && !identifiers.has(item.identifier)) await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
    await applyPlanningReminder(owner, personal, undefined, "workouts");
    for (const group of groups) await applyPlanningReminder(owner, group.settings, group, "workouts");
  });
}

export async function syncGroupPlanningReminders(owner: string, groups: { id: string; name: string; settings: WeeklyPlanningSettings }[]) {
  if (Platform.OS === "web") return;
  const identifiers = new Set(groups.map(group => `dinner-group-reset-${group.id}`));
  return serialized(async () => {
    for (const item of await Notifications.getAllScheduledNotificationsAsync()) {
      if (item.identifier.startsWith("dinner-group-reset-") && !identifiers.has(item.identifier)) await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
    for (const group of groups) await applyPlanningReminder(owner, group.settings, group);
  });
}
