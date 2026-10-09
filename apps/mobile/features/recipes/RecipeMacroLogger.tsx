import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { SearchField } from "@/components/SearchField";
import { useTransientMessage } from "@/components/useTransientMessage";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { MacroDatePicker } from "@/features/premium/MacroDatePicker";
import { isISODate, todayISO } from "@/features/premium/macroDates";
import { Calculation } from "@/features/premium/calculator";
import { apiFetch } from "@/services/api";
import { useOfflineStatus } from "@/services/offlineStore";
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
  const offline = useOfflineStatus(state => state.offline);
  const [recipe, setRecipe] = useState(initialRecipe);
  const [q, setQ] = useState("");
  const [mealDate, setMealDate] = useState(entry?.meal_date ?? date);
  const [label, setLabel] = useState(() => normalizeMealLabel(entry?.meal_label ?? initialRecipe?.meal_type));
  const [portions, setPortions] = useState(String(entry?.servings_consumed ?? 1));
  const [scaledPortions, setScaledPortions] = useState(entry?.servings_consumed || 1);
  const [nutrition, setNutrition] = useState(nutritionInputs(entry ?? initialRecipe?.nutrition));
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [localError, setLocalError] = useState("");
  const [recipeName, setRecipeName] = useState(entry?.entry_name ?? entry?.recipe_name ?? initialRecipe?.name ?? "");
  const [recipeNameOpen, setRecipeNameOpen] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [recipeStatus, setRecipeStatus] = useTransientMessage();
  const recipeRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const recipeFingerprint = JSON.stringify({ name: recipeName.trim(), label, portions, nutrition, notes });
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
  function amountEaten() {
    const amount = Number(portions);
    if (!portions.trim() || amount <= 0 || amount > 20 || !Number.isFinite(amount)) throw new Error("Enter between 0 and 20 servings, excluding zero.");
    return amount;
  }
  const save = useMutation({
    mutationFn: () => {
      const amount = amountEaten();
      if (!isISODate(mealDate)) throw new Error("Enter a valid date.");
      const totals = recipe?.calculator_id || entry?.calculator_id ? {} : parseNutrition(nutrition);
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
  const saveRecipe = useMutation<Recipe | Calculation, Error, string>({
    mutationFn: async () => {
      const amount = amountEaten();
      const name = recipeName.trim();
      if (name.length < 2) throw new Error("Enter a recipe name with at least two characters.");
      if (entry?.calculator_id) {
        const calculation = await apiFetch<Calculation>(`/api/v1/nutrition/calculations/${entry.calculator_id}`);
        // Keep provider references, never snapshot temporary database macros.
        const items = calculation.items.map(item => ({
          source: item.source, name: item.name, portions: item.portions * amount / entry.servings_consumed,
          ...(item.source === "fatsecret" ? { food_id: item.food_id, serving_id: item.serving_id } : { nutrition: item.nutrition })
        }));
        const payload = { name, meal_label: label, meal_date: mealDate, servings: 1, destination: "recipe", items };
        const fingerprint = JSON.stringify(payload);
        if (recipeRequest.current?.fingerprint !== fingerprint) recipeRequest.current = { fingerprint, id: Crypto.randomUUID() };
        return apiFetch<Calculation>("/api/v1/nutrition/calculations", {
          method: "POST", body: JSON.stringify({ ...payload, request_id: recipeRequest.current.id })
        });
      }
      return apiFetch<Recipe>("/api/v1/recipes", { method: "POST", body: JSON.stringify({
        name, description: notes.trim() || null, servings: 1, meal_type: label, source_type: "manual",
        nutrition: parseNutrition(nutrition), ingredients: [], instructions: [], accept_placeholder_photo: true
      }) });
    },
    onMutate: () => { setLocalError(""); setRecipeStatus(""); },
    onSuccess: async (_, fingerprint) => {
      setSavedFingerprint(fingerprint); setRecipeNameOpen(false); setRecipeStatus("Recipe saved to your library.");
      await client.invalidateQueries({ queryKey: ["recipes"] });
    }
  });
  const working = save.isPending || remove.isPending || saveRecipe.isPending;
  return <Modal visible transparent animationType="fade" onRequestClose={() => { if (!working) onClose(); }}>
    <View style={styles.backdrop}><View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.header}><Text style={styles.heading}>{entry ? "Edit logged meal" : "Log a recipe"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close recipe log" disabled={working} onPress={onClose} style={styles.icon}><Ionicons name="close" size={24} color={Colors.ink} /></Pressable></View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!recipe && !entry ? <>
          <SearchField accessibilityLabel="Search recipes to log" placeholder="Search recipes" value={q} onChangeText={setQ} />
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
          {recipe?.calculator_id || entry?.calculator_id ? <Text style={styles.meta}>Nutrition is calculated from the saved ingredients and servings.</Text> : <>
            <NutritionFields value={nutrition} onChange={setNutrition} />
            {recipe ? <Button label="Use recipe values" icon="refresh" onPress={() => { setNutrition(nutritionInputs(recipe.nutrition, scaledPortions)); setLocalError(""); }} /> : null}
          </>}
          <TextInput accessibilityLabel="Recipe log notes" placeholder="Notes" value={notes} onChangeText={setNotes} style={styles.input} />
          <Button label={save.isPending ? "Saving..." : "Save entry"} icon="checkmark" variant="primary" disabled={working || !isISODate(mealDate)} onPress={() => save.mutate()} />
          {entry ? <>
            <Button label="Delete entry" icon="trash-outline" disabled={working} onPress={() => remove.mutate()} />
            {recipeNameOpen ? <View style={styles.recipeName}>
              <View style={styles.header}><Text style={styles.name}>Recipe name</Text><View style={styles.cancel}>
                <Button label="" icon="close" accessibilityLabel="Cancel saving recipe" disabled={working} onPress={() => setRecipeNameOpen(false)} /></View></View>
              <TextInput accessibilityLabel="Logged meal recipe name" value={recipeName} onChangeText={setRecipeName} maxLength={160} editable={!working} style={styles.input} />
              <Text style={styles.meta}>Nutrition for 1 saved serving</Text>
            </View> : null}
            <Button label={saveRecipe.isPending ? "Saving recipe..." : savedFingerprint === recipeFingerprint ? "Recipe saved" : recipeNameOpen ? "Save recipe" : "Save as recipe"}
              icon="book-outline" disabled={working || offline || savedFingerprint === recipeFingerprint || (recipeNameOpen && recipeName.trim().length < 2)}
              onPress={() => { if (recipeNameOpen) saveRecipe.mutate(recipeFingerprint); else { saveRecipe.reset(); setRecipeNameOpen(true); } }} />
            {recipeStatus ? <Text accessibilityLiveRegion="polite" style={styles.success}>{recipeStatus}</Text> : null}
            {saveRecipe.isError ? <Text accessibilityRole="alert" style={styles.error}>{saveRecipe.error instanceof Error ? saveRecipe.error.message : "Unable to save recipe. Please try again."}</Text> : null}
          </> : null}
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
  meta: { color: Colors.muted }, error: { color: Colors.danger }, success: { color: Colors.basil },
  recipeName: { gap: 8 }, cancel: { marginLeft: "auto" }
});
