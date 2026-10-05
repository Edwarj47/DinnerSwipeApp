import type { WeeklyPlanningSettings } from "./types";

export async function clearPlanningReminders() {}
export async function requestPlanningNotificationPermission() { return false; }
export async function syncPlanningReminder(_owner: string, _settings: WeeklyPlanningSettings) {}
