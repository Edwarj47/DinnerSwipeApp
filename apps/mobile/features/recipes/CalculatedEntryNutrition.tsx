import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { ThemeColors, useThemedStyles } from "@/components/theme";
import { Calculation } from "@/features/premium/calculator";
import { NutritionAttribution } from "@/features/premium/NutritionAttribution";
import { apiFetch } from "@/services/api";
import { useMeasurementUnits } from "@/services/measurementPreferences";
import { useOfflineStatus } from "@/services/offlineStore";
import { convertWeight, formatWeight } from "@/services/weightUnits";
import { NUTRIENTS } from "./recipeNutrition";

export function CalculatedEntryNutrition({ calculationId, servings, savedEntryServings }: {
  calculationId: string; servings: number; savedEntryServings?: number;
}) {
  const styles = useThemedStyles(createStyles);
  const units = useMeasurementUnits();
  const offline = useOfflineStatus(state => state.offline);
  const calculation = useQuery({
    queryKey: ["nutrition-calculation", calculationId],
    queryFn: ({ signal }) => apiFetch<Calculation>(`/api/v1/nutrition/calculations/${calculationId}`, { signal }),
    enabled: !offline, retry: false, staleTime: 60_000, gcTime: 0
  });
  const data = calculation.data;
  // Entry responses already include their saved portion; recipe responses contain the whole yield.
  const divisor = savedEntryServings ?? data?.servings;
  const validAmount = Number.isFinite(servings) && servings > 0 && servings <= 20;
  const ratio = validAmount && divisor != null && Number.isFinite(divisor) && divisor > 0 ? servings / divisor : null;
  const visible = !offline && !calculation.isError && ratio != null;
  const incomplete = data?.nutrition_unavailable || (data && NUTRIENTS.some(([field]) => data.totals?.[field] == null));
  const status = offline ? "Reconnect to view calculated nutrition." : !validAmount ? "Enter more than 0 and up to 20 servings." :
    calculation.isLoading ? "Loading nutrition..." : calculation.isError ? "Couldn't load calculated nutrition." :
    data?.nutrition_unavailable ? "Some nutrition is unavailable. Totals are incomplete." :
    incomplete ? "Some nutrients weren't provided." : "";

  return <View style={styles.section}>
    <View style={styles.header}>
      <Text style={styles.heading}>Nutrition for this entry</Text>
      <Button label="" icon="refresh" accessibilityLabel="Refresh calculated nutrition" disabled={offline || calculation.isFetching}
        onPress={() => { void calculation.refetch(); }} />
    </View>
    <View style={styles.values}>{NUTRIENTS.map(([field, originalLabel]) => {
      const label = field === "calories" ? originalLabel : originalLabel.replace("(g)", `(${units[field]})`);
      const raw = visible ? data?.totals?.[field] : null;
      const value = raw == null || !Number.isFinite(raw) ? null : raw * ratio!;
      const text = value == null ? "-" : field === "calories" ? String(Math.round(value * 100) / 100) :
        formatWeight(convertWeight(value, "g", units[field])!, units[field]);
      return <View key={field} style={styles.value}>
        <Text style={styles.label}>{label}</Text>
        <Text accessibilityLabel={`Calculated ${label}`} accessibilityValue={{ text: text === "-" ? "Not available" : text }} style={styles.number}>{text}</Text>
      </View>;
    })}</View>
    {status ? <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text> : null}
    {!offline && data?.temporary_nutrition ? <NutritionAttribution /> : null}
  </View>;
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  section: { gap: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  heading: { flex: 1, minWidth: 0, color: Colors.ink, fontSize: 16, fontWeight: "700" },
  values: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  value: { flexGrow: 1, flexBasis: "40%", minWidth: 0, gap: 4 },
  label: { color: Colors.muted },
  number: { color: Colors.ink, fontSize: 17, fontWeight: "700" },
  status: { color: Colors.muted }
});
