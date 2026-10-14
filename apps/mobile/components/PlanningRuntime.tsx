import * as Notifications from "expo-notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { apiFetch } from "@/services/api";
import { ensurePlanningTimeZone, weeklyPlanning } from "@/services/planningPreferences";
import { syncPlanningReminder, syncGroupPlanningReminders } from "@/services/planningReminders";
import { useAppAccess, useAuthSession } from "@/services/session";
import { Household, UserProfile, WeeklyPlanningSettings } from "@/services/types";
import { applyGroupChange } from "@/features/groups/groupAccess";
import { setWorkoutsEnabled, updateWorkoutPreferences, useWorkoutMode } from "@/services/workoutMode";

export function PlanningRuntime() {
  const { email } = useAuthSession();
  const access = useAppAccess();
  const client = useQueryClient();
  const router = useRouter();
  const groups = useQuery<{ id: string; name: string; settings: WeeklyPlanningSettings }[]>({ queryKey: ["group-reminders"], enabled: access,
    queryFn: () => apiFetch("/api/v1/households/planning-reminders"), refetchInterval: 60_000 });
  useEffect(() => {
    if (email && Array.isArray(groups.data) && !groups.isError) void syncGroupPlanningReminders(email, groups.data).catch(() => undefined);
  }, [email, groups.data, groups.isError]);
  const profile = useQuery<UserProfile>({ queryKey: ["profile"], enabled: access,
    queryFn: async () => {
      await ensurePlanningTimeZone();
      return apiFetch<UserProfile>("/api/v1/profile");
    }
  });
  useEffect(() => {
    if (!email || !profile.data || profile.isError) return;
    const settings = weeklyPlanning(profile.data);
    const reconcile = () => { void syncPlanningReminder(email, settings).catch(() => undefined); };
    reconcile();
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") { reconcile(); void client.invalidateQueries({ queryKey: ["profile"] }); void client.invalidateQueries({ queryKey: ["group-reminders"] }); }
    });
    return () => listener.remove();
  }, [email, profile.data, profile.isError, client]);
  useEffect(() => {
    if (Platform.OS === "web") return;
    Notifications.setNotificationHandler({ handleNotification: async () => ({
      shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false
    }) });
    const open = (response: Notifications.NotificationResponse) => {
      if (response.notification.request.content.data?.route === "/week") {
        const data = response.notification.request.content.data;
        void (async () => {
          try {
            if (typeof data.household_id === "string") {
              const group = await apiFetch<Household>(`/api/v1/households/${data.household_id}/switch`, { method: "POST" });
              await applyGroupChange(client, group);
            }
            const mode = data.experience === "workouts" ? "workouts" : "nutrition";
            if (mode === "workouts") {
              const status = await apiFetch<{ enabled: boolean }>("/api/v1/workouts/status");
              setWorkoutsEnabled(status.enabled);
            }
            if (useWorkoutMode.getState().mode !== mode) await updateWorkoutPreferences({ mode });
          } catch { /* An unavailable group or experience opens the user's accessible current week. */ }
          router.push("/week");
        })();
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      }
    };
    const listener = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then(response => {
      if (response) open(response);
    }).catch(() => undefined);
    return () => listener.remove();
  }, [router, client]);
  return null;
}
