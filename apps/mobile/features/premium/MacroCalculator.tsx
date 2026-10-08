import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppState, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { NutritionFields } from "@/features/recipes/NutritionFields";
import { EMPTY_NUTRITION, NUTRIENTS, nutritionInputs, parseNutrition } from "@/features/recipes/recipeNutrition";
import { apiFetch } from "@/services/api";
import { useOfflineStatus } from "@/services/offlineStore";
import { MEAL_LABEL_OPTIONS, MealLabel } from "@/services/mealCategories";
import { useMeasurementUnits } from "@/services/measurementPreferences";
import { convertWeight, formatWeight } from "@/services/weightUnits";
import { RecipeNutrition } from "@/services/types";
import { MacroChoice } from "./MacroChoice";
import { todayISO } from "./macroDates";
import { Calculation, CalculatorRow, calculationItems, calculationTotal, objects, PROVIDER_VIEW_MS, servingNutrition } from "./calculator";
import { NutritionAttribution } from "./NutritionAttribution";

type Lookup = { data: Record<string, unknown> };

export function MacroCalculator({ calculationId, onClose, onSaved }: {
  calculationId?: string; onClose: () => void; onSaved?: (result: Calculation) => void;
}) {
  const client = useQueryClient();
  const offline = useOfflineStatus(state => state.offline);
  const [rows, setRows] = useState<CalculatorRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [itemOpen, setItemOpen] = useState(true);
  const [itemName, setItemName] = useState("");
  const [portions, setPortions] = useState("1");
  const [fields, setFields] = useState(EMPTY_NUTRITION);
  const [providerItem, setProviderItem] = useState<CalculatorRow | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [foodId, setFoodId] = useState("");
  const [servings, setServings] = useState<Record<string, unknown>[]>([]);
  const [searchedLabel, setSearchedLabel] = useState("");
  const [lookupExpires, setLookupExpires] = useState(0);
  const [busy, setBusy] = useState<string | null>(calculationId ? "Loading calculation..." : null);
  const [error, setError] = useState("");
  const [destination, setDestination] = useState<"entry" | "recipe" | null>(null);
  const [existing, setExisting] = useState<Pick<Calculation, "recipe_id" | "meal_date"> | null>(null);
  const [name, setName] = useState("");
  const [mealLabel, setMealLabel] = useState<MealLabel>("dinner");
  const [recipeServings, setRecipeServings] = useState("1");
  const request = useRef<{ payload: string; id: string } | null>(null);
  const total = calculationTotal(rows);

  useEffect(() => {
    if (!calculationId) return;
    const abort = new AbortController();
    void apiFetch<Calculation>(`/api/v1/nutrition/calculations/${calculationId}`, { signal: abort.signal }).then(result => {
      setExisting({ recipe_id: result.recipe_id, meal_date: result.meal_date }); setName(result.name); setMealLabel(result.meal_label);
      setRecipeServings(String(result.servings));
      setRows(result.items.map((item, index) => ({ ...item, key: Crypto.randomUUID(), values: result.resolved_items[index], servingLabel: result.serving_labels?.[index] ?? undefined,
        ...(item.source === "fatsecret" ? { expires: Date.now() + PROVIDER_VIEW_MS } : {}) })));
      setItemOpen(false);
      if (result.nutrition_unavailable) setError("Some database values are unavailable. Your ingredients are still saved.");
    }).catch(reason => { if (!abort.signal.aborted) setError(message(reason)); })
      .finally(() => { if (!abort.signal.aborted) setBusy(null); });
    return () => abort.abort();
  }, [calculationId]);

  // Clear expired provider views, including after the app resumes from background.
  useEffect(() => {
    function expire() {
      const now = Date.now();
      setRows(current => current.map(row => row.expires && row.expires <= now ? { ...row, values: emptyValues(), servingLabel: undefined } : row));
      if (providerItem?.expires && providerItem.expires <= now) { setProviderItem(current => current ? { ...current, values: emptyValues(), servingLabel: undefined } : null); setFields(EMPTY_NUTRITION); }
      if (lookupExpires && lookupExpires <= now) { setResults(null); setServings([]); setFoodId(""); setSearchOpen(false); }
    }
    const timer = setInterval(expire, 30000);
    const subscription = AppState.addEventListener("change", expire);
    return () => { clearInterval(timer); subscription.remove(); };
  }, [providerItem, lookupExpires]);

  function clearItem(open = true) {
    setEditing(null); setItemName(""); setPortions("1"); setFields(EMPTY_NUTRITION);
    setProviderItem(null); setError(""); setItemOpen(open);
  }
  function addItem() {
    try {
      const amount = Number(portions);
      if (!itemName.trim()) throw new Error("Enter an item name.");
      if (!portions.trim() || !Number.isFinite(amount) || amount <= 0 || amount > 100) throw new Error("Use more than 0 and up to 100 servings.");
      if (rows.length >= 30 && !editing) throw new Error("Use up to 30 items per calculation.");
      if (providerItem?.expires && providerItem.expires <= Date.now()) throw new Error("Search again to refresh this item.");
      const values = providerItem?.values ?? parseNutrition(fields);
      const row: CalculatorRow = { ...(providerItem ?? { source: "manual" as const }), key: editing ?? Crypto.randomUUID(),
        name: itemName.trim(), portions: amount, values };
      setRows(current => editing ? current.map(item => item.key === editing ? row : item) : [...current, row]);
      clearItem(false);
    } catch (reason) { setError(message(reason)); }
  }
  async function search() {
    setBusy("Searching..."); setError(""); setResults(null); setServings([]);
    try {
      const result = await apiFetch<Lookup>(`/api/v1/nutrition/foods/search?query=${encodeURIComponent(query.trim())}`);
      const foods = result.data.foods as Record<string, unknown> | undefined;
      setResults(objects(foods?.food)); setSearchedLabel(query.trim()); setLookupExpires(Date.now() + PROVIDER_VIEW_MS);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(null); }
  }
  async function chooseFood(id: string) {
    setBusy("Loading servings..."); setError("");
    try {
      const result = await apiFetch<Lookup>(`/api/v1/nutrition/foods/${id}`);
      const food = result.data.food as Record<string, unknown> | undefined;
      const container = food?.servings as Record<string, unknown> | undefined;
      const options = objects(container?.serving);
      if (!options.length) throw new Error("No servings found for this food. Try another result.");
      setServings(options); setFoodId(id); setLookupExpires(Date.now() + PROVIDER_VIEW_MS);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(null); }
  }
  function chooseServing(serving: Record<string, unknown>) {
    const values = servingNutrition(serving);
    const row: CalculatorRow = { key: editing ?? Crypto.randomUUID(), source: "fatsecret", name: searchedLabel,
      portions: 1, food_id: foodId, serving_id: String(serving.serving_id), servingLabel: String(serving.serving_description ?? "Serving"), values, expires: lookupExpires };
    setProviderItem(row); setItemName(searchedLabel); setPortions("1"); setSearchOpen(false);
    setItemOpen(true);
    setFields(nutritionInputs(values)); setResults(null); setServings([]);
  }
  async function refreshValues() {
    setBusy("Refreshing nutrition..."); setError("");
    try {
      const result = await apiFetch<Pick<Calculation, "resolved_items" | "serving_labels" | "nutrition_unavailable">>("/api/v1/nutrition/calculations/preview", {
        method: "POST", body: JSON.stringify({ items: calculationItems(rows) })
      });
      setRows(current => current.map((row, index) => row.source === "fatsecret" ? { ...row,
        values: result.resolved_items[index], servingLabel: result.serving_labels?.[index] ?? undefined,
        expires: Date.now() + PROVIDER_VIEW_MS } : row));
      if (result.nutrition_unavailable) setError("Some database nutrition is unavailable. Try again later.");
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(null); }
  }
  async function save() {
    if (!destination || !rows.length) return;
    setBusy("Saving..."); setError("");
    try {
      const count = destination === "recipe" ? Number(recipeServings) : 1;
      if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error("Use 1 to 30 recipe servings.");
      const payload = { name: name.trim(), destination, meal_label: mealLabel, servings: count,
        meal_date: existing?.meal_date ?? todayISO(), items: calculationItems(rows) };
      const fingerprint = JSON.stringify(payload);
      if (request.current?.payload !== fingerprint) request.current = { payload: fingerprint, id: Crypto.randomUUID() };
      const result = await apiFetch<Calculation>(calculationId ? `/api/v1/nutrition/calculations/${calculationId}` : "/api/v1/nutrition/calculations", {
        method: calculationId ? "PUT" : "POST", body: JSON.stringify({ ...payload, request_id: request.current.id })
      });
      await client.invalidateQueries({ predicate: item => ["recipes", "weekly-plan", "grocery"].includes(String(item.queryKey[0])) || String(item.queryKey[0]).startsWith("macro-") });
      onSaved?.(result); onClose();
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(null); }
  }

  return <Modal visible transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.header}><Ionicons name="calculator-outline" size={22} color={Colors.basil} />
          <Text style={styles.heading}>Macro calculator</Text><Button label="" icon="close" accessibilityLabel="Close macro calculator" disabled={!!busy} onPress={onClose} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {searchOpen ? <>
            <View style={styles.header}><Text style={styles.subheading}>Search Database</Text><Button label="" icon="arrow-back" accessibilityLabel="Back to calculator" disabled={!!busy} onPress={() => setSearchOpen(false)} /></View>
            <TextInput accessibilityLabel="Search food database" value={query} onChangeText={setQuery} placeholder="Food or brand" style={styles.input} maxLength={100} />
            <NutritionAttribution />
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} aria-checked={accepted} onPress={() => setAccepted(!accepted)} style={styles.check}>
              <Ionicons name={accepted ? "checkbox" : "square-outline"} size={22} color={Colors.tomato} /><Text style={styles.meta}>I agree to fatsecret's Terms of Use.</Text></Pressable>
            <Button label="Search" icon="search" variant="primary" disabled={!!busy || offline || !accepted || query.trim().length < 2} onPress={() => { void search(); }} />
            {servings.length ? <><Text style={styles.subheading}>Choose a serving</Text>{servings.map(serving => <Pressable key={String(serving.serving_id)} accessibilityRole="button" style={styles.result} onPress={() => chooseServing(serving)}>
              <Text style={styles.name}>{String(serving.serving_description ?? "Serving")}</Text><Text style={styles.meta}>{serving.calories == null ? "Calories unavailable" : `${serving.calories} cal`}</Text>
            </Pressable>)}</> : results?.map(food => <Pressable key={String(food.food_id)} accessibilityRole="button" disabled={!!busy} style={styles.result} onPress={() => { void chooseFood(String(food.food_id)); }}>
              <Text style={styles.name}>{String(food.food_name ?? "Food")}</Text><Text style={styles.meta}>{String(food.food_description ?? "")}</Text></Pressable>)}
            {results?.length === 0 ? <Text style={styles.meta}>No foods found. Try a different name.</Text> : null}
          </> : destination ? <>
            <Text style={styles.subheading}>{calculationId ? "Update calculation" : destination === "recipe" ? "Save as recipe" : "Add to today"}</Text>
            <TextInput accessibilityLabel="Calculation name" placeholder="Meal or recipe name" value={name} onChangeText={setName} maxLength={160} style={styles.input} />
            <MacroChoice label="Meal type" value={mealLabel} onChange={setMealLabel} options={MEAL_LABEL_OPTIONS} disabled={!!busy} />
            {destination === "recipe" ? <><Text style={styles.name}>Recipe servings</Text><TextInput accessibilityLabel="Calculation recipe servings" value={recipeServings} onChangeText={setRecipeServings} keyboardType="number-pad" style={styles.input} /></> : <Text style={styles.meta}>{existing?.meal_date ?? todayISO()}</Text>}
            <Totals value={total} />
            {rows.some(row => row.source === "fatsecret") ? <><Text style={styles.meta}>Database nutrition refreshes when viewed. Ingredients and portions stay saved.</Text><NutritionAttribution /></> : null}
            <View style={styles.actions}><Button label="Back" icon="arrow-back" disabled={!!busy} onPress={() => setDestination(null)} />
              <Button label={calculationId ? "Update" : destination === "recipe" ? "Save recipe" : "Add to today"} icon="checkmark" variant="primary" disabled={!!busy || offline || name.trim().length < 2} onPress={() => { void save(); }} /></View>
          </> : <>
            <View style={styles.actions}><Button label="Search Database" icon="search" disabled={!!busy || offline} onPress={() => { setError(""); setSearchOpen(true); }} />
              <Button label="New item" icon="add" disabled={!!busy} onPress={() => clearItem()} /></View>
            {itemOpen ? <>
            <TextInput accessibilityLabel="Calculator item name" placeholder="Item name" value={itemName} maxLength={160} onChangeText={setItemName} style={styles.input} />
            <View style={styles.header}><Text style={styles.name}>Servings</Text><TextInput accessibilityLabel="Calculator item servings" value={portions} onChangeText={setPortions} keyboardType="decimal-pad" style={[styles.input, styles.portions]} /></View>
            {providerItem?.servingLabel ? <Text style={styles.meta}>1 serving: {providerItem.servingLabel}</Text> : null}
            <Text style={styles.name}>Nutrition per serving</Text>
            {providerItem ? <><Totals value={providerItem.values} /><NutritionAttribution /></> : <NutritionFields value={fields} onChange={setFields} />}
            <View style={styles.actions}><Button label={editing ? "Update item" : "Add item"} icon={editing ? "checkmark" : "add"} variant="primary" disabled={!!busy || !itemName.trim()} onPress={addItem} />
              {rows.length ? <Button label="" icon="close" accessibilityLabel="Cancel item" disabled={!!busy} onPress={() => clearItem(false)} /> : null}</View>
            </> : null}
            <View style={styles.divider}><Text style={styles.subheading}>Items ({rows.length})</Text></View>
            {rows.map(row => <View key={row.key} style={styles.item}><View style={styles.itemInfo}><Text style={styles.name}>{row.name}</Text><Text style={styles.meta}>{row.portions} servings · {row.values.calories == null || (row.expires != null && row.expires <= Date.now()) ? "Nutrition pending" : `${Math.round(row.values.calories * row.portions * 100) / 100} cal`}</Text>{row.servingLabel ? <Text style={styles.meta}>1 serving: {row.servingLabel}</Text> : null}</View>
              <Button label="" icon="create-outline" accessibilityLabel={`Edit ${row.name}`} disabled={!!busy} onPress={() => { setItemOpen(true); setEditing(row.key); setItemName(row.name); setPortions(String(row.portions)); setFields(nutritionInputs(row.values)); setProviderItem(row.source === "fatsecret" ? row : null); setError(""); }} />
              <Button label="" icon="trash-outline" accessibilityLabel={`Remove ${row.name}`} variant="quiet-danger" disabled={!!busy} onPress={() => { setRows(current => current.filter(item => item.key !== row.key)); if (editing === row.key) clearItem(); }} /></View>)}
            <View style={styles.divider}><View style={styles.header}><Text style={styles.subheading}>Total</Text>
              {rows.some(row => row.source === "fatsecret") ? <Button label="" icon="refresh" accessibilityLabel="Refresh database nutrition" disabled={!!busy || offline} onPress={() => { void refreshValues(); }} /> : null}</View><Totals value={total} /></View>
            {rows.some(row => row.source === "fatsecret") ? <NutritionAttribution /> : null}
            <View style={styles.actions}>{existing ? <Button label="Update calculation" icon="save-outline" variant="primary" disabled={!rows.length || !!busy || offline} onPress={() => { clearItem(); setDestination(existing.recipe_id ? "recipe" : "entry"); }} /> : <>
              <Button label="Add to today" icon="checkmark" variant="primary" disabled={!rows.length || !!busy || offline} onPress={() => { clearItem(); setDestination("entry"); }} />
              <Button label="Save as recipe" icon="book-outline" disabled={!rows.length || !!busy || offline} onPress={() => { clearItem(); setDestination("recipe"); }} /></>}</View>
          </>}
          {offline ? <Text style={styles.error}>Reconnect to search or save this calculation.</Text> : null}
          {busy ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{busy}</Text> : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

function Totals({ value }: { value: RecipeNutrition }) {
  const units = useMeasurementUnits();
  return <View style={styles.totals}>{NUTRIENTS.map(([field, label]) => <View key={field} style={styles.metric}>
    <Text style={styles.meta}>{field === "calories" ? label : label.replace("(g)", `(${units[field]})`)}</Text>
    <Text style={styles.name}>{value[field] == null ? "-" : field === "calories" ? value[field] : formatWeight(convertWeight(value[field]!, "g", units[field])!, units[field])}</Text>
  </View>)}</View>;
}
function message(reason: unknown) { return reason instanceof Error ? reason.message : "Unable to complete this action. Try again."; }
function emptyValues(): RecipeNutrition { return { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null }; }
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 12 },
  sheet: { width: "100%", maxWidth: 540, maxHeight: "92%", backgroundColor: Colors.surface, borderRadius: 8, padding: 14, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 }, heading: { flex: 1, fontSize: 20, color: Colors.ink, fontWeight: "800" },
  content: { gap: 12, paddingBottom: 12 }, subheading: { fontSize: 17, fontWeight: "700", color: Colors.ink, flex: 1 },
  name: { fontSize: 14, fontWeight: "700", color: Colors.ink }, meta: { fontSize: 13, color: Colors.muted, flexShrink: 1 },
  input: { minHeight: 48, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, color: Colors.ink },
  portions: { width: 100, marginLeft: "auto" }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  item: { backgroundColor: Colors.softRed, borderRadius: 6, padding: 10, flexDirection: "row", alignItems: "center", gap: 4 },
  itemInfo: { flex: 1, gap: 4, minWidth: 0 }, result: { paddingVertical: 12, borderBottomWidth: 1, borderColor: Colors.border, gap: 4 },
  divider: { borderTopWidth: 1, borderColor: Colors.border, paddingTop: 12, gap: 12 },
  totals: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, metric: { minWidth: 80, flexGrow: 1, gap: 4 },
  error: { color: Colors.danger }, check: { flexDirection: "row", gap: 8, alignItems: "center", minHeight: 44 }
});
