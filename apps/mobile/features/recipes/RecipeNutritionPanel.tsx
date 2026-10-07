import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, useWindowDimensions, View, ViewStyle } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { PremiumStatus, Recipe } from "@/services/types";
import { NutritionFields } from "./NutritionFields";
import { RecipeMacroLogger } from "./RecipeMacroLogger";
import { NUTRIENTS, nutritionInputs, parseNutrition } from "./recipeNutrition";
import { convertWeight, formatWeight } from "@/services/weightUnits";
import { useMeasurementUnits } from "@/services/measurementPreferences";

export function RecipeNutritionPanel({ recipe, onUpdated }: { recipe: Recipe; onUpdated?: (recipe: Recipe) => void }) {
  const units = useMeasurementUnits();
  const { fontScale } = useWindowDimensions();
  const valueSize: ViewStyle = Platform.OS === "web" ? { minWidth: "max-content" as ViewStyle["minWidth"] } : { minWidth: 100 * fontScale };
  const client = useQueryClient();
  const [current, setCurrent] = useState(recipe);
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [fields, setFields] = useState(nutritionInputs(recipe.nutrition));
  useEffect(() => { setCurrent(recipe); setFields(nutritionInputs(recipe.nutrition)); }, [recipe]);
  const subscription = useQuery({ queryKey: ["subscription-status"], queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status") });
  const save = useMutation({
    mutationFn: () => apiFetch<Recipe>(`/api/v1/recipes/${recipe.id}/nutrition`, { method: "PUT", body: JSON.stringify(parseNutrition(fields)) }),
    onSuccess: async updated => { setCurrent(updated); setEditing(false); onUpdated?.(updated); await client.invalidateQueries({ queryKey: ["recipes"] }); }
  });
  return <View style={styles.panel}>
    <Text style={styles.heading}>Nutrition per serving</Text>
    {editing ? <>
      <NutritionFields value={fields} onChange={setFields} />
      <View style={styles.actions}><Button label="Save nutrition" icon="save" variant="primary" disabled={save.isPending} onPress={() => save.mutate()} />
        <Button label="Cancel" icon="close" disabled={save.isPending} onPress={() => setEditing(false)} /></View>
    </> : <>
      <View style={styles.values}>{NUTRIENTS.map(([key, label]) => <View key={key} style={[styles.value, valueSize]}>
        <Text style={styles.label}>{key === "calories" ? label : label.replace("(g)", `(${units[key]})`)}</Text>
        <Text style={styles.number}>{current.nutrition?.[key] == null ? "Not entered" : key === "calories" ? current.nutrition[key] : formatWeight(convertWeight(current.nutrition[key]!, "g", units[key])!, units[key])}</Text>
      </View>)}</View>
      <View style={styles.actions}>
        {recipe.can_edit ? <Button label="Edit nutrition" icon="create-outline" onPress={() => { setFields(nutritionInputs(current.nutrition)); setEditing(true); }} /> : null}
        {(subscription.data?.premium_active ?? subscription.data?.active) && !recipe.is_archived ? <Button label="Log meal" icon="add-circle-outline" variant="primary" onPress={() => setLogging(true)} /> : null}
      </View>
    </>}
    {save.isError ? <Text accessibilityRole="alert" style={styles.error}>{save.error instanceof Error ? save.error.message : "Unable to save nutrition."}</Text> : null}
    {logging ? <RecipeMacroLogger recipe={current} onClose={() => setLogging(false)} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  panel: { gap: 12, paddingVertical: 12, borderTopWidth: 1, borderColor: Colors.border },
  heading: { color: Colors.ink, fontSize: 18, fontWeight: "800" }, values: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  value: { flexGrow: 1, maxWidth: "100%", gap: 4 }, label: { color: Colors.muted }, number: { color: Colors.ink, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, error: { color: Colors.danger }
});
