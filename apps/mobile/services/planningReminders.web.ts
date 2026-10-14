import type { WeeklyPlanningSettings } from "./types";

export async function clearPlanningReminders() {}
export async function clearWorkoutPlanningReminders() {}
export async function requestPlanningNotificationPermission() { return false; }
export async function syncPlanningReminder(_owner: string, _settings: WeeklyPlanningSettings) {}
export async function syncGroupPlanningReminders(_owner: string, _groups: { id: string; name: string; settings: WeeklyPlanningSettings }[]) {}
export async function syncWorkoutPlanningReminders(_owner: string, _personal: WeeklyPlanningSettings, _groups: { id: string; name: string; settings: WeeklyPlanningSettings }[]) {}
