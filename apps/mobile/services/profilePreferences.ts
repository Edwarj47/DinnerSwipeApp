import { apiFetch } from "@/services/api";
import { UserProfile } from "@/services/types";

export function shouldConfirmPlanReset(profile?: UserProfile) {
  return profile?.notification_preferences?.confirm_plan_reset !== false;
}

export async function saveProfilePreferences(changes: Partial<UserProfile>) {
  // PUT replaces the profile. Read current values so saving one setting preserves the others.
  const current = await apiFetch<UserProfile>("/api/v1/profile");
  const updated = { ...current, ...changes, notification_preferences: {
    ...current.notification_preferences, ...changes.notification_preferences
  } };
  const { email, onboarding_completed_at, tutorial_completed_at, tutorial_dismissed_at, tutorial_version_seen, ...payload } = updated;
  return apiFetch<UserProfile>("/api/v1/profile", { method: "PUT", body: JSON.stringify(payload) });
}
