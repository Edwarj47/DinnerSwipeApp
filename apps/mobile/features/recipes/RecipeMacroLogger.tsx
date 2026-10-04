import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { MacroDatePicker } from "@/features/premium/MacroDatePicker";
import { isISODate, todayISO } from "@/features/premium/macroDates";
import { apiFetch } from "@/services/api";
import { MEAL_LABEL_OPTIONS, normalizeMealLabel } from "@/services/mealCategories";
import { MacroConfirmation, Recipe } from "@/services/types";
import { NutritionFields } from "./NutritionFields";
import { nutritionInputs, parseNutrition, scaleNutritionInputs } from "./recipeNutrition";
import { RecipePhoto } from "./RecipePhoto";

// Mount a fresh logger for each entry so drafts cannot leak between recipes or days.
export function RecipeMacroLogger({ recipe: initialRecipe, entry, date = todayISO(), onClose }: {
  recipe?: Recipe; entry?: MacroConfirmation; date?: string; onClose: () => void;
}) {
  const client = useQueryClient();
  const [recipe, setRecipe] = useState(initialRecipe);
  const [q, setQ] = useState("");
  const [mealDate, setMealDate] = useState(entry?.meal_date ?? date);
  const [label, setLabel] = useState(() => normalizeMealLabel(entry?.meal_label ?? initialRecipe?.meal_type));
  const [portions, setPortions] = useState(String(entry?.servings_consumed ?? 1));
  const [scaledPortions, setScaledPortions] = useState(entry?.servings_consumed || 1);
  const [nutrition, setNutrition] = useState(nutritionInputs(entry ?? initialRecipe?.nutrition));
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [localError, setLocalError] = useState("");
  const recipes = useInfiniteQuery({
    queryKey: ["recipes", "macro-picker", q], initialPageParam: 0,
    queryFn: ({ pageParam }) => apiFetch<Recipe[]>(`/api/v1/recipes?collection=library&limit=30&offset=${pageParam}&q=${encodeURIComponent(q)}`),
    getNextPageParam: (last, pages) => last.length === 30 ? pages.length * 30 : undefined,
    enabled: !recipe && !entry
  });
  function changePortions(text: string) {
    setPortions(text);
    const next = Number(text);
    if (text.trim() && Number.isFinite(next) && next > 0 && next <= 20) {
      try { setNutrition(scaleNutritionInputs(nutrition, next / scaledPortions)); setScaledPortions(next); setLocalError(""); }
      catch (error) { setLocalError(String(error)); }
    }
  }
  const save = useMutation({
    mutationFn: () => {
      const amount = Number(portions);
      if (!portions.trim() || amount <= 0 || amount > 20 || !Number.isFinite(amount)) throw new Error("Enter between 0 and 20 servings, excluding zero.");
      if (!isISODate(mealDate)) throw new Error("Enter a valid date.");
      const totals = parseNutrition(nutrition);
      // Save the reviewed totals, including explicit unknowns, so offline replay
      // cannot recalculate history from a recipe edited after this meal was logged.
      return apiFetch(entry ? `/api/v1/macros/entries/${entry.id}` : "/api/v1/macros/entries", { method: entry ? "PUT" : "POST",
        body: JSON.stringify({ ...totals, ...(!entry ? { recipe_id: recipe?.id } : {}), entry_name: entry?.entry_name ?? recipe?.name,
          meal_date: mealDate, meal_label: label, servings_consumed: amount, status: "ate", notes: notes.trim() || null }) });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith("macro-") });
      onClose();
    }
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/v1/macros/entries/${entry!.id}`, { method: "DELETE" }),
    onSuccess: async () => { await client.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith("macro-") }); onClose(); }
  });
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}><View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.header}><Text style={styles.heading}>{entry ? "Edit logged meal" : "Log a recipe"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close recipe log" disabled={save.isPending} onPress={onClose} style={styles.icon}><Ionicons name="close" size={24} color={Colors.ink} /></Pressable></View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!recipe && !entry ? <>
          <TextInput accessibilityLabel="Search recipes to log" placeholder="Search recipes" value={q} onChangeText={setQ} style={styles.input} />
          {recipes.isLoading ? <Text>Loading recipes...</Text> : null}
          {recipes.isError ? <Button label="Retry recipes" icon="refresh" onPress={() => { void recipes.refetch(); }} /> : null}
          {recipes.data?.pages.flat().map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Log ${item.name}`} style={styles.recipe}
            onPress={() => { setRecipe(item); setLabel(normalizeMealLabel(item.meal_type)); setNutrition(nutritionInputs(item.nutrition)); }}>
            <RecipePhoto photoUrl={item.photo_url} accessibilityLabel={`${item.name} photo`} style={styles.photo} /><View style={{ flex: 1 }}><Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.nutrition?.calories != null ? `${item.nutrition.calories} cal / serving` : "Calories not entered"}</Text></View>
            <Ionicons name="add-circle-outline" size={24} color={Colors.tomato} /></Pressable>)}
          {recipes.data && !recipes.data.pages.flat().length ? <Text style={styles.meta}>No recipes found.</Text> : null}
          {recipes.hasNextPage ? <Button label="More recipes" icon="chevron-down" disabled={recipes.isFetchingNextPage} onPress={() => { void recipes.fetchNextPage(); }} /> : null}
        </> : <>
          <Text style={styles.name}>{entry?.entry_name ?? entry?.recipe_name ?? recipe?.name}</Text>
          <View style={styles.header}><TextInput accessibilityLabel="Recipe log date" value={mealDate} onChangeText={setMealDate} style={[styles.input, styles.flexInput]} /><MacroDatePicker value={mealDate} onChange={setMealDate} /></View>
          <SegmentedControl accessibilityLabel="Logged meal" wrap value={label} onChange={setLabel} options={MEAL_LABEL_OPTIONS} />
          <Text style={styles.name}>Servings eaten</Text>
          <View style={styles.header}>
            <Button label="" accessibilityLabel="Half serving less" icon="remove" disabled={Number(portions) <= 0.5} onPress={() => changePortions(String(Math.max(0.5, Number(portions) - 0.5)))} />
            <TextInput accessibilityLabel="Servings eaten" keyboardType="decimal-pad" value={portions} onChangeText={changePortions} style={[styles.input, styles.flexInput, { textAlign: "center" }]} />
            <Button label="" accessibilityLabel="Half serving more" icon="add" disabled={Number(portions) >= 20} onPress={() => changePortions(String(Math.min(20, Number(portions) + 0.5)))} />
          </View>
          <Text style={styles.name}>Nutrition for this entry</Text>
          <NutritionFields value={nutrition} onChange={setNutrition} />
          {recipe ? <Button label="Use recipe values" icon="refresh" onPress={() => { setNutrition(nutritionInputs(recipe.nutrition, scaledPortions)); setLocalError(""); }} /> : null}
          <TextInput accessibilityLabel="Recipe log notes" placeholder="Notes" value={notes} onChangeText={setNotes} style={styles.input} />
          <Button label={save.isPending ? "Saving..." : "Save entry"} icon="checkmark" variant="primary" disabled={save.isPending || remove.isPending || !isISODate(mealDate)} onPress={() => save.mutate()} />
          {entry ? <Button label="Delete entry" icon="trash-outline" disabled={save.isPending || remove.isPending} onPress={() => remove.mutate()} /> : null}
        </>}
        {localError || save.isError ? <Text accessibilityRole="alert" style={styles.error}>{localError || (save.error instanceof Error ? save.error.message : "Unable to save entry.")}</Text> : null}
        {remove.isError ? <Text accessibilityRole="alert" style={styles.error}>Unable to delete entry. Please try again.</Text> : null}
      </ScrollView>
    </View></View>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 12 },
  sheet: { width: "100%", maxWidth: 540, maxHeight: "90%", backgroundColor: Colors.surface, borderRadius: 8, padding: 14, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 }, heading: { flex: 1, fontSize: 20, fontWeight: "800", color: Colors.ink },
  icon: { width: 44, height: 44, justifyContent: "center", alignItems: "center" }, content: { gap: 12, paddingBottom: 12 },
  input: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, color: Colors.ink },
  flexInput: { flex: 1, minWidth: 0, width: 0 },
  recipe: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderColor: Colors.border },
  photo: { width: 48, height: 48, borderRadius: 6 }, name: { color: Colors.ink, fontSize: 16, fontWeight: "700" },
  meta: { color: Colors.muted }, error: { color: Colors.danger }
});
