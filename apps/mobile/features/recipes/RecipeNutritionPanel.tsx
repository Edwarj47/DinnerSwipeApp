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
import { MacroCalculator } from "@/features/premium/MacroCalculator";
import { Calculation } from "@/features/premium/calculator";
import { NutritionAttribution } from "@/features/premium/NutritionAttribution";

export function RecipeNutritionPanel({ recipe, onUpdated }: { recipe: Recipe; onUpdated?: (recipe: Recipe) => void }) {
  const units = useMeasurementUnits();
  const { fontScale } = useWindowDimensions();
  const valueSize: ViewStyle = Platform.OS === "web" ? { minWidth: "max-content" as ViewStyle["minWidth"] } : { minWidth: 100 * fontScale };
  const client = useQueryClient();
  const [current, setCurrent] = useState(recipe);
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [calculator, setCalculator] = useState(false);
  const [fields, setFields] = useState(nutritionInputs(recipe.nutrition));
  useEffect(() => { setCurrent(recipe); setFields(nutritionInputs(recipe.nutrition)); }, [recipe]);
  const subscription = useQuery({ queryKey: ["subscription-status"], queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status") });
  const calculated = useQuery({ queryKey: ["nutrition-calculation", recipe.calculator_id],
    queryFn: () => apiFetch<Calculation>(`/api/v1/nutrition/calculations/${recipe.calculator_id}`),
    enabled: !!recipe.calculator_id && !!(subscription.data?.premium_active ?? subscription.data?.active), retry: false });
  const values = calculated.data ? Object.fromEntries(NUTRIENTS.map(([field]) => [field,
    calculated.data.totals[field] == null ? null : calculated.data.totals[field]! / calculated.data.servings])) as Recipe["nutrition"] : current.nutrition;
  const reloadRecipe = useMutation({
    mutationFn: () => apiFetch<Recipe>(`/api/v1/recipes/${recipe.id}`),
    onSuccess: updated => { setCurrent(updated); onUpdated?.(updated); }
  });
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
        <Text style={styles.number}>{values?.[key] == null ? recipe.calculator_id ? "Pending" : "Not entered" : key === "calories" ? values[key] : formatWeight(convertWeight(values[key]!, "g", units[key])!, units[key])}</Text>
      </View>)}</View>
      <View style={styles.actions}>
        {recipe.can_edit ? <Button label="Edit nutrition" icon="create-outline" onPress={() => {
          if (recipe.calculator_id) setCalculator(true); else { setFields(nutritionInputs(current.nutrition)); setEditing(true); }
        }} /> : null}
        {(subscription.data?.premium_active ?? subscription.data?.active) && !recipe.is_archived ? <Button label="Log meal" icon="add-circle-outline" variant="primary" onPress={() => setLogging(true)} /> : null}
      </View>
    </>}
    {calculated.data?.temporary_nutrition ? <NutritionAttribution /> : null}
    {calculated.isError || calculated.data?.nutrition_unavailable ? <Text style={styles.error}>Database nutrition is temporarily unavailable.</Text> : null}
    {save.isError ? <Text accessibilityRole="alert" style={styles.error}>{save.error instanceof Error ? save.error.message : "Unable to save nutrition."}</Text> : null}
    {reloadRecipe.isError ? <Text accessibilityRole="alert" style={styles.error}>Recipe saved. Reopen it to refresh the details.</Text> : null}
    {logging ? <RecipeMacroLogger recipe={current} onClose={() => setLogging(false)} /> : null}
    {calculator && recipe.calculator_id ? <MacroCalculator calculationId={recipe.calculator_id} onClose={() => setCalculator(false)} onSaved={() => { void calculated.refetch(); reloadRecipe.mutate(); }} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  panel: { gap: 12, paddingVertical: 12, borderTopWidth: 1, borderColor: Colors.border },
  heading: { color: Colors.ink, fontSize: 18, fontWeight: "800" }, values: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  value: { flexGrow: 1, maxWidth: "100%", gap: 4 }, label: { color: Colors.muted }, number: { color: Colors.ink, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, error: { color: Colors.danger }
});
