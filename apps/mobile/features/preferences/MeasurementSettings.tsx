import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { apiFetch, reconnectOffline } from "@/services/api";
import { deviceOffline } from "@/services/offlineStore";
import { MEASUREMENTS, measurementUnits } from "@/services/measurementPreferences";
import { saveProfilePreferences } from "@/services/profilePreferences";
import { UserProfile } from "@/services/types";
import { WeightUnit } from "@/services/weightUnits";

export function MeasurementSettings() {
  const client = useQueryClient();
  const profile = useQuery<UserProfile>({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/api/v1/profile"), retry: false });
  const units = measurementUnits(profile.data);
  const save = useMutation({
    mutationFn: async ({ preference, unit }: { preference: string; unit: WeightUnit }) => {
      if (deviceOffline()) await reconnectOffline();
      return saveProfilePreferences({ notification_preferences: { [preference]: unit } });
    },
    onSuccess: data => client.setQueryData(["profile"], data)
  });
  return <View style={styles.section}>
    <Text style={styles.heading}>Measurement units</Text>
    {MEASUREMENTS.map(({ key, label, preference }) => <View key={key} style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.options}><SegmentedControl accessibilityLabel={`${label} units`} value={units[key]}
        options={[
          { label: "g", value: "g", accessibilityLabel: `${label} in grams` },
          { label: "oz", value: "oz", accessibilityLabel: `${label} in ounces` }
        ]} disabled={!profile.data || profile.isError || save.isPending}
        onChange={unit => { if (unit !== units[key]) save.mutate({ preference, unit }); }} /></View>
    </View>)}
    {save.isError ? <Text accessibilityRole="alert" style={styles.error}>Couldn't save measurement units. Try again.</Text> : null}
    {profile.isError ? <Text accessibilityRole="alert" style={styles.error}>Reconnect to change measurement units.</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8 }, heading: { color: Colors.ink, fontWeight: "900" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: { flex: 1, minWidth: 0, color: Colors.ink, fontWeight: "700", lineHeight: 21 },
  options: { width: 132 }, error: { color: Colors.danger, fontSize: 14, lineHeight: 20 }
});
