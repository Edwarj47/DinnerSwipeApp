import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Platform, Switch, Text, View } from "react-native";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Button } from "@/components/Button";
import { ResetDaySelection } from "@/features/preferences/ResetDaySelection";
import { apiFetch } from "@/services/api";
import { requestPlanningNotificationPermission } from "@/services/planningReminders";
import { WeeklyPlanningSettings } from "@/services/types";
import { useWorkoutOwner } from "./WorkoutRuntime";
import { workoutKey, workoutPath, workoutWrite } from "./api";
import { WorkoutQueryState, styles } from "./ui";

export function WorkoutSettings({ groupId }: { groupId?: string }) {
  const owner = useWorkoutOwner(), client = useQueryClient();
  const key = workoutKey(owner, "reset-settings", groupId ?? "personal");
  const settings = useQuery<WeeklyPlanningSettings>({ queryKey: key,
    queryFn: () => apiFetch(workoutPath("planning-settings", groupId)), enabled: Boolean(owner), retry: false });
  const save = useMutation({ mutationFn: async (patch: Partial<WeeklyPlanningSettings>) => {
    if (patch.notify && Platform.OS !== "web" && !await requestPlanningNotificationPermission()) throw new Error("Allow notifications in device settings first.");
    const value = settings.data as WeeklyPlanningSettings;
    return workoutWrite<WeeklyPlanningSettings>(`planning-settings${groupId ? `?household_id=${encodeURIComponent(groupId)}` : ""}`, "PUT", {
      mode: value.mode, reset_day: value.reset_day, notify: value.notify, time_zone: value.time_zone, ...patch });
  }, onSuccess: value => { client.setQueryData(key, value); void client.invalidateQueries({ queryKey: workoutKey(owner, "reminders") }); } });
  const value = settings.data as WeeklyPlanningSettings | undefined;
  return <View style={{ gap: 12 }}>
    <WorkoutQueryState loading={settings.isLoading} error={settings.error} retry={() => { void settings.refetch(); }} />
    {value && !settings.isError ? <>
      <SegmentedControl accessibilityLabel="Workout reset mode" value={value.mode} disabled={save.isPending}
        options={[{ value: "manual", label: "Manual" }, { value: "automatic", label: "Weekly" }]} onChange={mode => save.mutate({ mode })} />
      {value.mode === "automatic" ? <><ResetDaySelection value={value.reset_day} disabled={save.isPending} onChange={reset_day => save.mutate({ reset_day })} />
        {Platform.OS !== "web" ? <View style={styles.row}><Text style={[styles.label, styles.copy]}>Weekly notification</Text><Switch accessibilityLabel="Workout weekly notification" value={value.notify} disabled={save.isPending} onValueChange={notify => save.mutate({ notify })} /></View> : null}</> : null}
    </> : null}
    {save.error ? <Text accessibilityRole="alert" style={styles.error}>{save.error.message}</Text> : null}
    {save.isError ? <Button label="Retry settings" icon="refresh" onPress={() => { save.reset(); void settings.refetch(); }} /> : null}
  </View>;
}
