import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { useTransientMessage } from "@/components/useTransientMessage";
import { WeightTextInput } from "@/components/WeightUnits";
import { apiFetch } from "@/services/api";
import { useMeasurementUnits } from "@/services/measurementPreferences";
import { MacroTarget } from "@/services/types";

export function MacroTargetSettings() {
  const client = useQueryClient();
  const units = useMeasurementUnits();
  const [values, setValues] = useState({ calories: "", protein: "", carbs: "", fat: "", goal: "" });
  const [status, setStatus] = useTransientMessage();
  const [error, setError] = useState("");
  const targets = useQuery({ queryKey: ["macro-targets"],
    queryFn: () => apiFetch<MacroTarget>("/api/v1/macros/targets"), retry: false });
  useEffect(() => {
    if (targets.data) setValues({ calories: input(targets.data.daily_calories), protein: input(targets.data.daily_protein_g),
      carbs: input(targets.data.daily_carbs_g), fat: input(targets.data.daily_fat_g), goal: targets.data.goal ?? "" });
  }, [targets.data]);
  const save = useMutation({
    mutationFn: () => apiFetch<MacroTarget>("/api/v1/macros/targets", { method: "PUT", body: JSON.stringify({
      daily_calories: number(values.calories), daily_protein_g: number(values.protein),
      daily_carbs_g: number(values.carbs), daily_fat_g: number(values.fat), goal: values.goal.trim() || null
    }) }),
    onMutate: () => { setError(""); setStatus(""); },
    onSuccess: async data => {
      client.setQueryData(["macro-targets"], data);
      await client.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith("macro-") });
      setStatus("Macro targets saved.");
    },
    onError: reason => setError(reason instanceof Error ? reason.message : "Unable to save targets.")
  });
  function change(field: keyof typeof values, value: string) { setValues(current => ({ ...current, [field]: value })); }
  return <View style={styles.content}>
    {targets.isError ? <><Text style={styles.error}>Couldn't load targets.</Text><Button label="Retry targets" icon="refresh" onPress={() => { void targets.refetch(); }} /></> : null}
    <View style={styles.grid}>
      <View style={styles.field}><Text style={styles.label}>Calories</Text><TextInput accessibilityLabel="Daily calories target" value={values.calories} onChangeText={value => change("calories", value)} keyboardType="number-pad" placeholder="Not set" style={styles.input} /></View>
      {([ ["protein", "protein_g", "Protein"], ["carbs", "carbs_g", "Carbs"], ["fat", "fat_g", "Fat"] ] as const).map(([field, nutrient, label]) =>
        <View key={field} style={styles.field}><Text style={styles.label}>{label} ({units[nutrient]})</Text><WeightTextInput accessibilityLabel={`Daily ${field} target`} grams={values[field]} onChangeGrams={value => change(field, value)} unit={units[nutrient]} placeholder="Not set" style={styles.input} /></View>)}
    </View>
    <Text style={styles.label}>Goal</Text><TextInput accessibilityLabel="Macro goal" value={values.goal} maxLength={80} onChangeText={value => change("goal", value)} placeholder="Goal" style={styles.input} />
    <Button label="Save targets" icon="save" variant="primary" disabled={!targets.data || save.isPending} onPress={() => save.mutate()} />
    {status ? <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}
function input(value: number | null | undefined) { return value == null ? "" : String(value); }
function number(value: string) {
  if (!value.trim()) return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error("Use a positive number or leave the target blank.");
  return result;
}
const styles = StyleSheet.create({
  content: { gap: 10 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  field: { flexGrow: 1, flexBasis: "45%", minWidth: 0, gap: 6 },
  label: { fontSize: 14, fontWeight: "700", color: Colors.ink },
  input: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, color: Colors.ink, backgroundColor: Colors.surface },
  status: { color: Colors.basil }, error: { color: Colors.danger }
});
