import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuthSession } from "@/services/session";
import { clearWorkoutPlanningReminders, syncWorkoutPlanningReminders } from "@/services/planningReminders";
import { WeeklyPlanningSettings } from "@/services/types";
import { ApiError, apiFetch } from "@/services/api";
import { offlineOwner, useOfflineStatus } from "@/services/offlineStore";
import { bindWorkoutModeClient, resetWorkoutMode, restoreWorkoutPreferences, seedWorkoutPreferences, setWorkoutsEnabled, useWorkoutMode } from "@/services/workoutMode";
import { restoreWorkoutQueue, syncWorkoutPerformance, useWorkoutQueue, workoutRead } from "./storage";
import { workoutKey } from "./api";

export function useWorkoutOwner() { return useOfflineStatus(() => offlineOwner()); }
export function useIsWorkoutMode() { return useWorkoutMode(state => state.enabled && state.mode === "workouts"); }
export function WorkoutRuntime() {
  const owner = useWorkoutOwner(), client = useQueryClient();
  const { email } = useAuthSession();
  const enabled = useWorkoutMode(state => state.enabled);
  const reminders = useQuery<{ personal: WeeklyPlanningSettings; groups: { id: string; name: string; settings: WeeklyPlanningSettings }[] }>({
    queryKey: workoutKey(owner, "reminders"), queryFn: () => workoutRead("/api/v1/workouts/planning-reminders"),
    enabled: Boolean(owner) && enabled, retry: false, refetchInterval: 60000 });
  useEffect(() => { if (email && enabled && reminders.data && !reminders.isError) void syncWorkoutPlanningReminders(email, reminders.data.personal, reminders.data.groups).catch(() => undefined); }, [email, enabled, reminders.data, reminders.isError]);
  const status = useQuery({ queryKey: workoutKey(owner, "status"), enabled: Boolean(owner), retry: false,
    refetchInterval: 60000, queryFn: async () => {
      try { return await workoutRead<{ enabled: boolean }>("/api/v1/workouts/status"); }
      catch (error) { if (error instanceof ApiError && error.status === 404) return { enabled: false }; throw error; }
    } });
  useEffect(() => {
    if (owner && (status.data?.enabled === false || (status.error instanceof ApiError && [401, 402, 403, 404].includes(status.error.status)))) {
      void clearWorkoutPlanningReminders().catch(() => undefined);
    }
  }, [owner, status.data?.enabled, status.error]);
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<{ experience_preferences?: unknown }>("/api/v1/profile"), enabled: Boolean(owner), retry: false });
  useEffect(() => {
    bindWorkoutModeClient(client);
    if (useWorkoutMode.getState().owner !== owner) resetWorkoutMode(owner);
    if (!owner) return;
    void restoreWorkoutPreferences(owner).catch(() => undefined);
    void restoreWorkoutQueue().catch(error => useWorkoutQueue.setState({ error: error.message }));
    return () => { bindWorkoutModeClient(null); client.removeQueries({ queryKey: ["workouts", owner] }); };
  }, [owner, client]);
  useEffect(() => { seedWorkoutPreferences(profile.data?.experience_preferences); }, [profile.data, owner]);
  useEffect(() => {
    const enabled = Boolean(status.data?.enabled) && !status.isError;
    setWorkoutsEnabled(enabled);
    if (enabled) seedWorkoutPreferences(profile.data?.experience_preferences);
  }, [status.data, status.isError, profile.data, owner]);
  useEffect(() => {
    const retry = async () => {
      if (!owner || offlineOwner() !== owner || AppState.currentState === "background") return;
      const count = useWorkoutQueue.getState().pending.length;
      await syncWorkoutPerformance();
      if (offlineOwner() === owner && useWorkoutQueue.getState().pending.length !== count) {
        void client.invalidateQueries({ queryKey: workoutKey(owner, "logs") });
        void client.invalidateQueries({ queryKey: workoutKey(owner, "progress") });
      }
    };
    const unsubscribe = useOfflineStatus.subscribe((state, previous) => { if (!state.offline && previous.offline) void retry(); });
    const app = AppState.addEventListener("change", state => { if (state === "active") void retry(); });
    const timer = setInterval(() => { if (useWorkoutQueue.getState().pending.length) void retry(); }, 30000);
    void retry();
    return () => { unsubscribe(); app.remove(); clearInterval(timer); };
  }, [owner, client]);
  return null;
}
