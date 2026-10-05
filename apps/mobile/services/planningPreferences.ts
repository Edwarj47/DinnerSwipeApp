import { apiFetch } from "@/services/api";
import { deviceOffline, offlineOwner } from "@/services/offlineStore";
import { UserProfile, WeeklyPlanningSettings } from "@/services/types";

export const RESET_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function weeklyPlanning(profile?: UserProfile): WeeklyPlanningSettings {
  return profile?.weekly_planning ?? {
    mode: "manual", reset_day: 0, notify: true, time_zone: deviceTimeZone()
  };
}

export function saveWeeklyPlanning(settings: WeeklyPlanningSettings, initializeOnly = false) {
  const { time_zone_configured: ignored, ...values } = settings;
  return apiFetch<UserProfile>("/api/v1/profile/planning", {
    method: "PATCH", body: JSON.stringify({ ...values, initialize_only: initializeOnly })
  });
}

let initializedOwner: string | null = null;
let initialization: Promise<void> | null = null;

export async function ensurePlanningTimeZone() {
  const owner = offlineOwner();
  if (!owner || deviceOffline() || initializedOwner === owner) return;
  if (initialization) return initialization;
  initialization = (async () => {
    const profile = await apiFetch<UserProfile>("/api/v1/profile");
    if (offlineOwner() !== owner || deviceOffline()) return;
    if (profile.weekly_planning?.time_zone_configured === false) {
      await saveWeeklyPlanning({ ...weeklyPlanning(profile), time_zone: deviceTimeZone() }, true);
    }
    if (offlineOwner() === owner && !deviceOffline()) initializedOwner = owner;
  })().finally(() => { initialization = null; });
  return initialization;
}
