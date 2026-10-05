import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Switch, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { useTransientMessage } from "@/components/useTransientMessage";
import { apiFetch } from "@/services/api";
import { deviceTimeZone, saveWeeklyPlanning, weeklyPlanning } from "@/services/planningPreferences";
import { requestPlanningNotificationPermission, syncPlanningReminder } from "@/services/planningReminders";
import { UserProfile, WeeklyPlanningSettings as Settings } from "@/services/types";
import { ResetDaySelection } from "./ResetDaySelection";

export function WeeklyPlanningSettings() {
  const client = useQueryClient();
  const profile = useQuery<UserProfile>({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/api/v1/profile") });
  const [settings, setSettings] = useState<Settings>(() => weeklyPlanning(profile.data));
  const [status, setStatus] = useTransientMessage();
  useEffect(() => { if (profile.data) setSettings(weeklyPlanning(profile.data)); }, [profile.data]);
  const save = useMutation({
    mutationFn: async () => {
      let next = settings;
      let denied = false;
      if (next.mode === "automatic" && next.notify && Platform.OS !== "web") {
        const granted = await requestPlanningNotificationPermission();
        if (!granted) { next = { ...next, notify: false }; denied = true; }
      }
      const data = await saveWeeklyPlanning(next);
      let reminderFailed = false;
      try { await syncPlanningReminder(data.email, weeklyPlanning(data)); }
      catch { reminderFailed = true; }
      return { data, denied, reminderFailed };
    },
    onSuccess: ({ data, denied, reminderFailed }) => {
      client.setQueryData(["profile"], data);
      void client.invalidateQueries();
      setStatus(reminderFailed ? "Settings saved. Couldn't update the phone reminder. Save again to retry."
        : denied ? "Settings saved. Phone reminders need notification permission." : "Planning settings saved.");
    }
  });
  const disabled = !profile.data || profile.isError || save.isPending;
  const automatic = settings.mode === "automatic";
  return <View style={styles.section}>
    <Text style={styles.heading}>Weekly reset</Text>
    <SegmentedControl accessibilityLabel="Weekly reset mode" value={settings.mode} disabled={disabled}
      options={[{ label: "Manual only", value: "manual" }, { label: "Automatic", value: "automatic" }]}
      onChange={mode => { setSettings(current => ({ ...current, mode })); save.reset(); }} />
    <Text style={styles.meta}>{automatic ? "Start fresh on your reset day. Logged nutrition stays saved."
      : "Keep your meals each week. Reset them only when you choose."}</Text>
    {automatic ? <>
      <ResetDaySelection value={settings.reset_day} disabled={disabled}
        onChange={reset_day => setSettings(current => ({ ...current, reset_day }))} />
      <Text style={styles.meta}>At midnight in {settings.time_zone.replace(/_/g, " ")}.</Text>
      <View style={styles.row}><Text style={styles.label}>Weekly phone reminder</Text>
        <Switch accessibilityLabel="Weekly phone reminder" disabled={disabled}
          value={settings.notify} onValueChange={notify => setSettings(current => ({ ...current, notify }))}
          thumbColor={settings.notify ? Colors.tomato : Colors.surface}
          trackColor={{ false: Colors.border, true: "#f4aaa8" }} /></View>
      {settings.notify ? <Text style={styles.meta}>9 AM on your reset day, in your phone's time zone.</Text> : null}
      {Platform.OS === "web" ? <Text style={styles.meta}>Phone reminders are scheduled when you open the mobile app.</Text> : null}
    </> : null}
    {settings.time_zone !== deviceTimeZone() ? <Button label="Use this device's time zone" icon="time-outline"
      disabled={disabled} onPress={() => setSettings(current => ({ ...current, time_zone: deviceTimeZone() }))} /> : null}
    <Button label="Save planning settings" icon="save" variant="primary" disabled={disabled}
      onPress={() => save.mutate()} />
    {status ? <Text accessibilityLiveRegion="polite" style={styles.success}>{status}</Text> : null}
    {save.isError ? <Text accessibilityRole="alert" style={styles.error}>{save.error instanceof Error ? save.error.message : "Couldn't save planning settings. Try again."}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 12 }, heading: { color: Colors.ink, fontWeight: "900", fontSize: 16 },
  meta: { color: Colors.muted, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: { flex: 1, color: Colors.ink, fontWeight: "700", minWidth: 0 },
  success: { color: Colors.basil, fontWeight: "700", lineHeight: 20 },
  error: { color: Colors.danger, lineHeight: 20 }
});
