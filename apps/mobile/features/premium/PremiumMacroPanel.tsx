import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Share, StyleSheet, Text, TextInput, useWindowDimensions, View, ViewStyle } from "react-native";

import { Button } from "@/components/Button";
import { SUCCESS_MESSAGE_MS } from "@/components/useTransientMessage";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { WeightTextInput } from "@/components/WeightUnits";
import { convertWeight, formatWeight } from "@/services/weightUnits";
import { NutrientWeight, useMeasurementUnits } from "@/services/measurementPreferences";
import { apiFetch, savedMessage } from "@/services/api";
import { saveProfilePreferences } from "@/services/profilePreferences";
import { useOfflineStatus } from "@/services/offlineStore";
import { MealLabel, MEAL_LABEL_OPTIONS, normalizeMealLabel } from "@/services/mealCategories";
import { formatMealType } from "@/features/recipes/recipeDisplay";
import { parseNutrition } from "@/features/recipes/recipeNutrition";
import { MacroChoice } from "./MacroChoice";
import { SummaryPeriod, summaryDays } from "./SummaryPeriod";
import { RecipeMacroLogger } from "@/features/recipes/RecipeMacroLogger";
import { MacroDatePicker } from "./MacroDatePicker";
import { MacroCalculator } from "./MacroCalculator";
import { NutritionAttribution } from "./NutritionAttribution";
import { TourTarget } from "@/features/onboarding/TourTarget";
import { CalendarSort, calendarDays, isISODate, macroRangeQuery, shiftISODate, todayISO } from "./macroDates";
import {
  MacroAnalytics,
  MacroConfirmation,
  MacroExport,
  MacroSummary,
  MacroTarget,
  PremiumStatus,
  Recipe,
  UserProfile
} from "@/services/types";

type MacroView = "day" | "grid" | "calendar" | "analytics";

export function PremiumMacroPanel() {
  const units = useMeasurementUnits();
  const unit = units.protein_g;
  const pendingMacros = useOfflineStatus(state => state.edits.some(edit => edit.kind.startsWith("macro_")));
  const offline = useOfflineStatus(state => state.offline);
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const setStatus = (message: string) => setNotice({ message, error: false });
  const setError = (message: string) => setNotice({ message, error: true });
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [goal, setGoal] = useState("");
  const [macroView, setMacroView] = useState<MacroView>("day");
  const [trendRange, setTrendRange] = useState("30");
  const [calendarRange, setCalendarRange] = useState("14");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [entryName, setEntryName] = useState("");
  const [mealLabel, setMealLabel] = useState<MealLabel>("dinner");
  const [entryCalories, setEntryCalories] = useState("");
  const [entryProtein, setEntryProtein] = useState("");
  const [entryCarbs, setEntryCarbs] = useState("");
  const [entryFat, setEntryFat] = useState("");
  const [entryFiber, setEntryFiber] = useState("");
  const [entryNotes, setEntryNotes] = useState("");
  const [savedRecipeFingerprint, setSavedRecipeFingerprint] = useState<string | null>(null);
  const recipeDraft = { name: entryName.trim(), description: entryNotes.trim() || null, servings: 1,
    meal_type: mealLabel, source_type: "manual", nutrition: { calories: entryCalories, protein_g: entryProtein,
      carbs_g: entryCarbs, fat_g: entryFat, fiber_g: entryFiber } };
  const recipeFingerprint = JSON.stringify(recipeDraft);
  const [recipeLog, setRecipeLog] = useState<MacroConfirmation | "new" | null>(null);
  const [calculator, setCalculator] = useState<string | "new" | null>(null);
  const [summarySelection, setSummarySelection] = useState<number | null>(null);
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/api/v1/profile") });
  const summaryRange = summarySelection ?? summaryDays(profile.data?.notification_preferences?.macro_summary_days) ?? 7;
  const summaryEnd = todayISO();
  const saveSummaryRange = useMutation({
    mutationFn: (range: number) => saveProfilePreferences({ notification_preferences: { macro_summary_days: range } }),
    onSuccess: updated => { queryClient.setQueryData(["profile"], updated); setSummarySelection(null); },
    onError: () => { setSummarySelection(null); setError("Couldn't save the summary period. Try again."); }
  });

  const subscription = useQuery({
    queryKey: ["subscription-status"],
    queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"),
    retry: false
  });
  const premiumActive = Boolean(subscription.data?.premium_active ?? subscription.data?.active);
  const summary = useQuery({
    queryKey: ["macro-summary", summaryRange, summaryEnd],
    queryFn: () => apiFetch<MacroSummary>(`/api/v1/macros/summary?days=${summaryRange}&end_date=${summaryEnd}`),
    enabled: premiumActive && !profile.isLoading,
    retry: false
  });
  const targets = useQuery({
    queryKey: ["macro-targets"],
    queryFn: () => apiFetch<MacroTarget>("/api/v1/macros/targets"),
    enabled: premiumActive,
    retry: false
  });
  const entries = useQuery({
    queryKey: ["macro-entries", selectedDate],
    queryFn: () => apiFetch<MacroConfirmation[]>(`/api/v1/macros/entries?start_date=${selectedDate}&end_date=${selectedDate}`),
    enabled: premiumActive && macroView === "day" && isISODate(selectedDate),
    retry: false
  });
  const analytics = useQuery({
    queryKey: ["macro-analytics", "trends", trendRange],
    queryFn: () => apiFetch<MacroAnalytics>(`/api/v1/macros/analytics?${macroRangeQuery(trendRange)}`),
    enabled: premiumActive && macroView === "analytics",
    retry: false
  });
  const calendarAnalytics = useQuery({
    queryKey: ["macro-analytics", "calendar", calendarRange],
    queryFn: () => apiFetch<MacroAnalytics>(`/api/v1/macros/analytics?days=${calendarRange}`),
    enabled: premiumActive && (macroView === "calendar" || macroView === "grid"),
    retry: false
  });
  const selectedEntries = useMemo<MacroConfirmation[]>(
    () => (entries.data ?? []).filter((entry: MacroConfirmation) => entry.meal_date === selectedDate),
    [entries.data, selectedDate]
  );
  const selectedTotal = useMemo(
    () => entries.data ? ({ calories: selectedEntries.reduce((sum, item) => sum + (item.calories ?? 0), 0),
      protein_g: selectedEntries.reduce((sum, item) => sum + (item.protein_g ?? 0), 0), entry_count: selectedEntries.length }) : undefined,
    [entries.data, selectedEntries]
  );

  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), SUCCESS_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => { setNotice(null); }, [macroView]);

  useEffect(() => {
    if (!targets.data) return;
    setCalories(valueToInput(targets.data.daily_calories));
    setProtein(valueToInput(targets.data.daily_protein_g));
    setCarbs(valueToInput(targets.data.daily_carbs_g));
    setFat(valueToInput(targets.data.daily_fat_g));
    setGoal(targets.data.goal ?? "");
  }, [targets.data]);

  const saveTargets = useMutation({
    mutationFn: () =>
      apiFetch<MacroTarget>("/api/v1/macros/targets", {
        method: "PUT",
        body: JSON.stringify({
          daily_calories: inputToNumber(calories),
          daily_protein_g: inputToNumber(protein),
          daily_carbs_g: inputToNumber(carbs),
          daily_fat_g: inputToNumber(fat),
          goal: goal.trim() || null
        })
      }),
    onSuccess: async () => {
      setStatus("Macro targets saved.");
      await refreshPremium(queryClient);
    },
    onError: (error) => setError(error instanceof Error ? error.message : "Unable to save targets.")
  });

  const saveEntry = useMutation({
    mutationFn: () => {
      const payload = macroEntryPayload({
        entryName,
        mealLabel,
        selectedDate,
        entryCalories,
        entryProtein,
        entryCarbs,
        entryFat,
        entryFiber,
        entryNotes
      });
      if (editingEntryId) {
        return apiFetch<MacroConfirmation>(`/api/v1/macros/entries/${editingEntryId}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
      }
      return apiFetch<MacroConfirmation>("/api/v1/macros/entries", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    },
    onSuccess: async () => {
      setStatus(savedMessage(editingEntryId ? "Macro entry updated." : "Macro entry added."));
      clearEntryForm();
      await refreshPremium(queryClient);
    },
    onError: (error) => setError(error instanceof Error ? error.message : "Unable to save macro entry.")
  });

  const deleteEntry = useMutation({
    mutationFn: (entryId: string) =>
      apiFetch<{ status: string }>(`/api/v1/macros/entries/${entryId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setStatus(savedMessage("Macro entry removed."));
      clearEntryForm();
      await refreshPremium(queryClient);
    },
    onError: (error) => setError(error instanceof Error ? error.message : "Unable to remove macro entry.")
  });

  const saveAsRecipe = useMutation({
    mutationFn: (draft: typeof recipeDraft) => apiFetch<Recipe>("/api/v1/recipes", {
      method: "POST", body: JSON.stringify({ ...draft, nutrition: parseNutrition(draft.nutrition) })
    }),
    onMutate: () => setNotice(null),
    onSuccess: async (_, draft) => {
      setSavedRecipeFingerprint(JSON.stringify(draft));
      setStatus("Recipe saved with nutrition for one serving.");
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
    onError: error => setError(error instanceof Error ? error.message : "Unable to save recipe. Try again.")
  });

  const exportMacros = useMutation({
    mutationFn: () => apiFetch<MacroExport>(`/api/v1/macros/export?${macroRangeQuery(trendRange)}`),
    onSuccess: async (data) => {
      await deliverMacroExport(data);
      setStatus("Macro export generated.");
    },
    onError: (error) => setError(error instanceof Error ? error.message : "Unable to export macros.")
  });

  function beginEdit(entry: MacroConfirmation) {
    if (entry.calculator_id) { setCalculator(entry.calculator_id); return; }
    if (entry.recipe_id) { setRecipeLog(entry); return; }
    setEditingEntryId(entry.id);
    setSelectedDate(entry.meal_date);
    setEntryName(entry.entry_name ?? entry.recipe_name ?? "");
    setMealLabel(normalizeMealLabel(entry.meal_label));
    setEntryCalories(valueToInput(entry.calories));
    setEntryProtein(valueToInput(entry.protein_g));
    setEntryCarbs(valueToInput(entry.carbs_g));
    setEntryFat(valueToInput(entry.fat_g));
    setEntryFiber(valueToInput(entry.fiber_g));
    setEntryNotes(entry.notes ?? "");
    setMacroView("day");
  }

  function clearEntryForm() {
    setEditingEntryId(null);
    setEntryName("");
    setMealLabel("dinner");
    setEntryCalories("");
    setEntryProtein("");
    setEntryCarbs("");
    setEntryFat("");
    setEntryFiber("");
    setEntryNotes("");
  }

  const activeQuery = macroView === "day" ? entries : macroView === "analytics" ? analytics : calendarAnalytics;
  function pickDay(day: string) { setSelectedDate(day); clearEntryForm(); setMacroView("day"); }

  return (
    <View style={styles.panel}>
      <Text style={styles.section}>Macro Tracker</Text>
      {!premiumActive ? (
        <View style={styles.lockedBox}>
          <Text style={styles.lockedTitle}>Upgrade to track macros.</Text>
          <Text style={styles.meta}>
            Premium tracks meals you confirm from This Week and manual daily entries you add here.
          </Text>
          {Platform.OS !== "web" ? (
            <Text style={styles.meta}>
              Native app-store subscription flow will be added before public iOS or Android sales.
            </Text>
          ) : null}
        </View>
      ) : (
        <>
          <TourTarget id="macros"><SummaryPeriod days={summaryRange} disabled={saveSummaryRange.isPending || !profile.data} onChange={range => {
            setSummarySelection(range); saveSummaryRange.mutate(range);
          }} />
          {pendingMacros ? <Text style={styles.meta}>Summary and trends exclude changes waiting to sync.</Text> : null}
          {summary.isError ? <Button label="Retry summary" icon="refresh" onPress={() => { void summary.refetch(); }} /> : null}
          {summary.data ? <Text style={styles.meta}>{summary.data.start_date} to {summary.data.end_date}</Text> : null}
          <View style={styles.metrics}>
            <Metric label="Consumed" value={summary.data ? String(summary.data.eaten_meals) : "-"} />
            <Metric label="Protein" value={summary.data ? `${formatWeight(convertWeight(summary.data.totals.protein_g, "g", unit)!, unit)} ${unit}` : "-"} />
            <Metric label="Calories" value={summary.data ? String(summary.data.totals.calories) : "-"} />
          </View></TourTarget>
          {summary.data?.temporary_nutrition ? <NutritionAttribution /> : null}
          {summary.data?.nutrition_unavailable_count ? <Text style={styles.error}>Some database nutrition is pending. Totals are incomplete.</Text> : null}

          <View style={styles.targetBox}>
            <Text style={styles.subsection}>Targets</Text>
            <View style={styles.grid}>
              <MacroField label="Calories"><TextInput accessibilityLabel="Daily calories target" value={calories} onChangeText={setCalories} keyboardType="number-pad" placeholder="Not set" style={styles.input} /></MacroField>
              <MacroField label={`Protein (${unit})`}><WeightTextInput accessibilityLabel="Daily protein target" grams={protein} onChangeGrams={setProtein} unit={unit} placeholder="Not set" style={styles.input} /></MacroField>
              <MacroField label={`Carbs (${units.carbs_g})`}><WeightTextInput accessibilityLabel="Daily carbs target" grams={carbs} onChangeGrams={setCarbs} unit={units.carbs_g} placeholder="Not set" style={styles.input} /></MacroField>
              <MacroField label={`Fat (${units.fat_g})`}><WeightTextInput accessibilityLabel="Daily fat target" grams={fat} onChangeGrams={setFat} unit={units.fat_g} placeholder="Not set" style={styles.input} /></MacroField>
            </View>
            <Text style={styles.fieldLabel}>Goal</Text>
            <TextInput accessibilityLabel="Macro goal" value={goal} onChangeText={setGoal} placeholder="Goal" style={styles.input} />
            <Button
              label="Save targets"
              icon="save"
              variant="primary"
              disabled={saveTargets.isPending}
              onPress={() => saveTargets.mutate()}
            />
          </View>

          <SegmentedControl
            adaptive
            accessibilityLabel="Macro views"
            value={macroView}
            onChange={setMacroView}
            options={[
              { label: "Day", value: "day" },
              { label: "Grid", value: "grid" },
              { label: "Calendar", value: "calendar" },
              { label: "Trends", value: "analytics" }
            ]}
          />

          {activeQuery.isError ? <View style={styles.queryStatus}>
            <Text accessibilityRole="alert" style={styles.error}>Couldn't load macro data.</Text>
            <Button label="Retry macros" icon="refresh" onPress={() => { void activeQuery.refetch(); }} />
          </View> : activeQuery.isLoading && (macroView !== "day" || isISODate(selectedDate)) ? <Text style={styles.meta}>Loading macros...</Text> : null}

          {macroView !== "day" && (macroView === "analytics" ? analytics.data : calendarAnalytics.data)?.temporary_nutrition ? <NutritionAttribution /> : null}
          {macroView !== "day" && (macroView === "analytics" ? analytics.data : calendarAnalytics.data)?.nutrition_unavailable_count ? <Text style={styles.error}>Some database nutrition is pending. Totals are incomplete.</Text> : null}
          {macroView === "day" ? (
            <><Button label="Log a saved recipe" icon="restaurant-outline" onPress={() => setRecipeLog("new")} />
            <DayMacroView
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              selectedTotal={selectedTotal}
              selectedEntries={selectedEntries}
              entryName={entryName}
              setEntryName={setEntryName}
              mealLabel={mealLabel}
              setMealLabel={setMealLabel}
              entryCalories={entryCalories}
              setEntryCalories={setEntryCalories}
              entryProtein={entryProtein}
              setEntryProtein={setEntryProtein}
              entryCarbs={entryCarbs}
              setEntryCarbs={setEntryCarbs}
              entryFat={entryFat}
              setEntryFat={setEntryFat}
              entryFiber={entryFiber}
              setEntryFiber={setEntryFiber}
              entryNotes={entryNotes}
              setEntryNotes={setEntryNotes}
              editingEntryId={editingEntryId}
              savePending={saveEntry.isPending || saveAsRecipe.isPending || !isISODate(selectedDate)}
              recipeSaveDisabled={offline || saveEntry.isPending || saveAsRecipe.isPending || entryName.trim().length < 2 || savedRecipeFingerprint === recipeFingerprint}
              recipeSaved={savedRecipeFingerprint === recipeFingerprint}
              onSaveRecipe={() => saveAsRecipe.mutate(recipeDraft)}
              deletePending={deleteEntry.isPending}
              onSave={() => saveEntry.mutate()}
              onClear={clearEntryForm}
              onDelete={() => editingEntryId ? deleteEntry.mutate(editingEntryId) : undefined}
              onEdit={beginEdit}
              onCalculator={() => setCalculator("new")}
            /></>
          ) : null}
          {recipeLog ? <RecipeMacroLogger entry={recipeLog === "new" ? undefined : recipeLog} date={selectedDate}
            onClose={() => setRecipeLog(null)} /> : null}
          {calculator ? <MacroCalculator calculationId={calculator === "new" ? undefined : calculator}
            onClose={() => setCalculator(null)} onSaved={result => {
              if (result.entry_id) { setSelectedDate(result.meal_date ?? todayISO()); setMacroView("day"); }
              setStatus(result.recipe_id ? "Recipe saved with ingredients and nutrition." : "Calculation added to your macro entries.");
            }} /> : null}

          {macroView === "grid" ? (
            <GridMacroView dailyTotals={calendarAnalytics.data?.daily_totals ?? []} onPickDay={pickDay} />
          ) : null}

          {macroView === "calendar" ? (
            <CalendarMacroView dailyTotals={calendarAnalytics.data?.daily_totals ?? []} targetCalories={targets.data?.daily_calories ?? null}
              range={calendarRange} onRange={setCalendarRange} onPickDay={pickDay} />
          ) : null}

          {macroView === "analytics" ? (
            <AnalyticsMacroView
              analytics={analytics.data}
              range={trendRange}
              onRange={setTrendRange}
              exportPending={pendingMacros || exportMacros.isPending || !analytics.data || analytics.isError}
              onExport={() => exportMacros.mutate()}
            />
          ) : null}
        </>
      )}
      {summary.data?.unmatched_meals ? <Text style={styles.meta}>{summary.data.unmatched_meals} meals need macro review.</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" accessibilityRole={notice.error ? "alert" : undefined} style={notice.error ? styles.error : styles.status}>{notice.message}</Text> : null}
    </View>
  );
}

function DayMacroView({
  selectedDate,
  setSelectedDate,
  selectedTotal,
  selectedEntries,
  entryName,
  setEntryName,
  mealLabel,
  setMealLabel,
  entryCalories,
  setEntryCalories,
  entryProtein,
  setEntryProtein,
  entryCarbs,
  setEntryCarbs,
  entryFat,
  setEntryFat,
  entryFiber,
  setEntryFiber,
  entryNotes,
  setEntryNotes,
  editingEntryId,
  savePending,
  recipeSaveDisabled,
  recipeSaved,
  onSaveRecipe,
  deletePending,
  onSave,
  onClear,
  onDelete,
  onEdit,
  onCalculator
}: {
  selectedDate: string;
  setSelectedDate: (value: string) => void;
  selectedTotal?: { calories: number; protein_g: number; entry_count: number };
  selectedEntries: MacroConfirmation[];
  entryName: string;
  setEntryName: (value: string) => void;
  mealLabel: MealLabel;
  setMealLabel: (value: MealLabel) => void;
  entryCalories: string;
  setEntryCalories: (value: string) => void;
  entryProtein: string;
  setEntryProtein: (value: string) => void;
  entryCarbs: string;
  setEntryCarbs: (value: string) => void;
  entryFat: string;
  setEntryFat: (value: string) => void;
  entryFiber: string;
  setEntryFiber: (value: string) => void;
  entryNotes: string;
  setEntryNotes: (value: string) => void;
  editingEntryId: string | null;
  savePending: boolean;
  recipeSaveDisabled: boolean;
  recipeSaved: boolean;
  onSaveRecipe: () => void;
  deletePending: boolean;
  onSave: () => void;
  onClear: () => void;
  onDelete: () => void;
  onEdit: (entry: MacroConfirmation) => void;
  onCalculator: () => void;
}) {
  const units = useMeasurementUnits();
  const unit = units.protein_g;
  return (
    <View style={styles.viewBox}>
      <View style={styles.dayHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous macro day" style={styles.dateArrow} onPress={() => setSelectedDate(shiftISODate(selectedDate, -1))}>
          <Ionicons name="chevron-back" size={22} color={Colors.ink} />
        </Pressable>
        <TextInput accessibilityLabel="Macro date" value={selectedDate} onChangeText={setSelectedDate} autoCorrect={false} maxLength={10} placeholder="YYYY-MM-DD" style={[styles.input, styles.dateInput]} />
        <MacroDatePicker value={selectedDate} onChange={setSelectedDate} />
        <Pressable accessibilityRole="button" accessibilityLabel="Next macro day" style={styles.dateArrow} onPress={() => setSelectedDate(shiftISODate(selectedDate, 1))}>
          <Ionicons name="chevron-forward" size={22} color={Colors.ink} />
        </Pressable>
      </View>
      {!isISODate(selectedDate) ? <Text style={styles.error}>Enter a date as YYYY-MM-DD.</Text> : null}
      <View style={styles.metrics}>
        <Metric label="Calories" value={selectedTotal ? String(selectedTotal.calories) : "-"} />
        <Metric label="Protein" value={selectedTotal ? `${formatWeight(convertWeight(selectedTotal.protein_g, "g", unit)!, unit)} ${unit}` : "-"} />
        <Metric label="Entries" value={selectedTotal ? String(selectedTotal.entry_count) : "-"} />
      </View>

      <View style={styles.entryForm}>
        <Text style={styles.subsection}>{editingEntryId ? "Edit entry" : "Add macro entry"}</Text>
        <TextInput accessibilityLabel="Entry name" value={entryName} onChangeText={setEntryName} placeholder="Meal, snack, or beverage" style={styles.input} />
        <Text style={styles.fieldLabel}>Meal type</Text>
        <MacroChoice label="Meal type" value={mealLabel} onChange={setMealLabel} options={MEAL_LABEL_OPTIONS} disabled={savePending} />
        <View style={styles.grid}>
          <MacroField label="Calories"><TextInput accessibilityLabel="Calories" value={entryCalories} onChangeText={setEntryCalories} keyboardType="number-pad" placeholder="Optional" style={styles.input} /></MacroField>
          <MacroField label={`Protein (${unit})`}><WeightTextInput accessibilityLabel={`Protein ${unit === "g" ? "grams" : "ounces"}`} grams={entryProtein} onChangeGrams={setEntryProtein} unit={unit} placeholder="Optional" style={styles.input} /></MacroField>
          <MacroField label={`Carbs (${units.carbs_g})`}><WeightTextInput accessibilityLabel={`Carbs ${units.carbs_g === "g" ? "grams" : "ounces"}`} grams={entryCarbs} onChangeGrams={setEntryCarbs} unit={units.carbs_g} placeholder="Optional" style={styles.input} /></MacroField>
          <MacroField label={`Fat (${units.fat_g})`}><WeightTextInput accessibilityLabel={`Fat ${units.fat_g === "g" ? "grams" : "ounces"}`} grams={entryFat} onChangeGrams={setEntryFat} unit={units.fat_g} placeholder="Optional" style={styles.input} /></MacroField>
          <MacroField label={`Fiber (${units.fiber_g})`}><WeightTextInput accessibilityLabel={`Fiber ${units.fiber_g === "g" ? "grams" : "ounces"}`} grams={entryFiber} onChangeGrams={setEntryFiber} unit={units.fiber_g} placeholder="Optional" style={styles.input} /></MacroField>
        </View>
        <Text style={styles.fieldLabel}>Notes</Text>
        <TextInput accessibilityLabel="Entry notes" value={entryNotes} onChangeText={setEntryNotes} placeholder="Notes" style={styles.input} />
        <View style={styles.actions}>
          <Button label={editingEntryId ? "Update" : "Add"} icon={editingEntryId ? "save" : "add-circle"} variant="primary" disabled={savePending || !entryName.trim()} onPress={onSave} />
          <Button label="Clear" icon="close" onPress={onClear} />
          <View style={styles.actions}><Button label={recipeSaved ? "Recipe saved" : "Save as recipe"} icon="book-outline" disabled={recipeSaveDisabled} onPress={onSaveRecipe} />
            <Button label="" icon="calculator-outline" accessibilityLabel="Open macro calculator" onPress={onCalculator} /></View>
          {editingEntryId ? <Button label="Delete" icon="trash" variant="danger" disabled={deletePending} onPress={onDelete} /> : null}
        </View>
      </View>

      <View style={styles.entryList}>
        {selectedEntries.some(entry => entry.temporary_nutrition) ? <NutritionAttribution /> : null}
        {selectedEntries.some(entry => entry.nutrition_unavailable) ? <Text style={styles.error}>Some database nutrition is pending. Today's totals are incomplete.</Text> : null}
        <Text style={styles.subsection}>Logged on {selectedDate}</Text>
        {selectedEntries.length === 0 ? <Text style={styles.meta}>No macro entries for this date yet.</Text> : null}
        {selectedEntries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} onPress={() => onEdit(entry)} />
        ))}
      </View>
    </View>
  );
}

function GridMacroView({
  dailyTotals,
  onPickDay
}: {
  dailyTotals: MacroAnalytics["daily_totals"];
  onPickDay: (day: string) => void;
}) {
  const unit = useMeasurementUnits().protein_g;
  const recent = dailyTotals.slice(-7);
  return (
    <View style={styles.viewBox}>
      <Text style={styles.subsection}>Last 7 days</Text>
      <View style={styles.dayGrid}>
        {recent.map((day) => (
          <Pressable key={day.meal_date} accessibilityRole="button" onPress={() => onPickDay(day.meal_date)} style={styles.dayCard}>
            <Text style={styles.dayName}>{shortDate(day.meal_date)}</Text>
            <Text style={styles.dayCalories}>{day.calories}</Text>
            <Text style={styles.miniLabel}>calories</Text>
            <Text style={styles.miniText}>{formatWeight(convertWeight(day.protein_g, "g", unit)!, unit)} {unit} protein</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function CalendarMacroView({
  dailyTotals,
  targetCalories,
  range,
  onRange,
  onPickDay
}: {
  dailyTotals: MacroAnalytics["daily_totals"];
  targetCalories: number | null;
  range: string;
  onRange: (range: string) => void;
  onPickDay: (day: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<CalendarSort>("newest");
  const recent = calendarDays(dailyTotals, filter === "logged", sort);
  const scale = targetCalories || Math.max(1, ...dailyTotals.map(day => day.calories));
  return (
    <View style={styles.viewBox}>
      <Text style={styles.subsection}>Calendar view</Text>
      <View style={styles.actions}>
        <MacroChoice label="Calendar period" value={range} onChange={onRange} options={[
          { value: "14", label: "Last 14 days" }, { value: "30", label: "Last 30 days" },
          { value: "90", label: "Last 90 days" }, { value: "365", label: "Last 365 days" }
        ]} />
        <MacroChoice label="Filter days" value={filter} onChange={setFilter} options={[
          { value: "all", label: "All days" }, { value: "logged", label: "Logged days" }
        ]} />
        <MacroChoice<CalendarSort> label="Sort days" value={sort} onChange={setSort} options={[
          { value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" },
          { value: "calories_high", label: "Highest calories" }, { value: "calories_low", label: "Lowest calories" }
        ]} />
      </View>
      {targetCalories ? <Text style={styles.meta}>Daily target: {targetCalories} Cal</Text> : null}
      <View style={styles.calendarRow}>
        <Text style={[styles.miniLabel, { flex: 1 }]}>Date</Text><Text accessibilityLabel="Calories" style={[styles.calendarValue, styles.miniLabel]}>Cal</Text>
      </View>
      {!recent.length ? <Text style={styles.meta}>No matching days in this period.</Text> : null}
      {recent.map((day) => {
        const percent = Math.min(100, Math.round((day.calories / scale) * 100));
        return (
          <Pressable key={day.meal_date} accessibilityRole="button" accessibilityLabel={`${day.meal_date}: ${day.calories} calories, ${day.entry_count} entries`}
            onPress={() => onPickDay(day.meal_date)} style={styles.calendarRow}>
            <View style={styles.calendarLabel}>
              <Text style={styles.dayName}>{shortDate(day.meal_date)}</Text>
              <Text style={styles.miniText}>{day.entry_count} entries</Text>
            </View>
            <View style={styles.calendarTrack}>
              <View style={[styles.calendarFill, { width: `${percent}%` }]} />
            </View>
            <Text style={styles.calendarValue}>{day.calories}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AnalyticsMacroView({
  analytics,
  range,
  onRange,
  exportPending,
  onExport
}: {
  analytics?: MacroAnalytics;
  range: string;
  onRange: (range: string) => void;
  exportPending: boolean;
  onExport: () => void;
}) {
  const unit = useMeasurementUnits().protein_g;
  return (
    <View style={styles.viewBox}>
      <Text style={styles.subsection}>{range === "all" ? "All-time analytics" : `${range}-day analytics`}</Text>
      <MacroChoice label="Analytics period" value={range} onChange={onRange} options={[
        { value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" },
        { value: "365", label: "Last 365 days" }, { value: "all", label: "All time" }
      ]} />
      {analytics ? <Text style={styles.meta}>{analytics.start_date} to {analytics.end_date}</Text> : null}
      <View style={styles.metrics}>
        <Metric label="Days logged" value={String(analytics?.days_logged ?? 0)} />
        <Metric label="Cal / logged day" value={String(analytics?.averages.calories ?? 0)} />
        <Metric label="Protein / logged day" value={`${formatWeight(convertWeight(analytics?.averages.protein_g ?? 0, "g", unit)!, unit)} ${unit}`} />
      </View>
      <View style={styles.analyticsList}>
        <MacroLine label="Calories" value={analytics?.totals.calories ?? 0} target={analytics?.targets.daily_calories ?? null} />
        <MacroLine label="Protein" value={analytics?.totals.protein_g ?? 0} target={analytics?.targets.daily_protein_g ?? null} nutrient="protein_g" />
        <MacroLine label="Carbs" value={analytics?.totals.carbs_g ?? 0} target={analytics?.targets.daily_carbs_g ?? null} nutrient="carbs_g" />
        <MacroLine label="Fat" value={analytics?.totals.fat_g ?? 0} target={analytics?.targets.daily_fat_g ?? null} nutrient="fat_g" />
      </View>
      <Button label="Export analytics" icon="download" variant="primary" disabled={exportPending} onPress={onExport} />
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { fontScale } = useWindowDimensions();
  const sizing: ViewStyle = Platform.OS === "web" ? { minWidth: "max-content" as ViewStyle["minWidth"], flexBasis: "auto" } : { minWidth: 100 * fontScale, flexBasis: 100 * fontScale };
  return (
    <View style={[styles.metric, sizing]}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function MacroField({ label, children }: { label: string; children: ReactNode }) {
  const { fontScale } = useWindowDimensions();
  return <View style={[styles.field, fontScale > 1.3 && { flexBasis: "100%" }]}>
    <Text style={styles.fieldLabel}>{label}</Text>{children}
  </View>;
}

function EntryRow({ entry, onPress }: { entry: MacroConfirmation; onPress: () => void }) {
  const unit = useMeasurementUnits().protein_g;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.entryRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.entryTitle}>{entry.entry_name ?? entry.recipe_name ?? "Macro entry"}</Text>
        <Text style={styles.meta}>
          {formatMealType(entry.meal_label ?? "meal")} - {entry.calories ?? 0} cal - {formatWeight(convertWeight(entry.protein_g ?? 0, "g", unit)!, unit)} {unit} protein
        </Text>
      </View>
      <Text style={styles.editText}>Edit</Text>
    </Pressable>
  );
}

function MacroLine({
  label,
  value,
  target,
  nutrient
}: {
  label: string;
  value: number;
  target?: number | null;
  nutrient?: NutrientWeight;
}) {
  const units = useMeasurementUnits();
  const unit = units[nutrient ?? "protein_g"];
  const displaySuffix = nutrient ? ` ${unit}` : "";
  const displayValue = nutrient ? formatWeight(convertWeight(value, "g", unit)!, unit) : value;
  const displayTarget = nutrient && target != null ? formatWeight(convertWeight(target, "g", unit)!, unit) : target;
  const targetText = target ? `Daily target: ${displayTarget}${displaySuffix}` : "";
  return (
    <View style={styles.macroLine}>
      <Text style={styles.macroLineLabel}>{label}</Text>
      <Text style={styles.macroLineValue}>
        Total: {displayValue}
        {displaySuffix}
      </Text>
      {targetText ? <Text style={styles.meta}>{targetText}</Text> : null}
    </View>
  );
}

async function refreshPremium(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["subscription-status"] }),
    queryClient.invalidateQueries({ queryKey: ["premium-status"] }),
    queryClient.invalidateQueries({ queryKey: ["macro-summary"] }),
    queryClient.invalidateQueries({ queryKey: ["macro-targets"] }),
    queryClient.invalidateQueries({ queryKey: ["macro-entries"] }),
    queryClient.invalidateQueries({ queryKey: ["macro-analytics"] })
  ]);
}

function macroEntryPayload({
  entryName,
  mealLabel,
  selectedDate,
  entryCalories,
  entryProtein,
  entryCarbs,
  entryFat,
  entryFiber,
  entryNotes
}: {
  entryName: string;
  mealLabel: MealLabel;
  selectedDate: string;
  entryCalories: string;
  entryProtein: string;
  entryCarbs: string;
  entryFat: string;
  entryFiber: string;
  entryNotes: string;
}) {
  return {
    entry_name: entryName.trim(),
    meal_label: mealLabel,
    meal_date: selectedDate,
    status: "ate",
    servings_consumed: 1,
    calories: inputToNumber(entryCalories),
    protein_g: inputToNumber(entryProtein),
    carbs_g: inputToNumber(entryCarbs),
    fat_g: inputToNumber(entryFat),
    fiber_g: inputToNumber(entryFiber),
    notes: entryNotes.trim() || null
  };
}

async function deliverMacroExport(data: MacroExport) {
  const filename = `dinner-swipe-macros-${data.analytics.start_date}-to-${data.analytics.end_date}.json`;
  const body = JSON.stringify(data, null, 2);
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const blob = new Blob([body], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  await Share.share({ title: filename, message: body });
}

function valueToInput(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function inputToNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() ? parsed : null;
}

function shortDate(value: string) {
  const [, month, day] = value.split("-").map(Number);
  return `${month}/${day}`;
}

const styles = StyleSheet.create({
  panel: { gap: 12, marginTop: 12, marginBottom: 8 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "center" },
  section: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  subsection: { color: Colors.ink, fontWeight: "900", fontSize: 16 },
  meta: { color: Colors.muted, lineHeight: 20 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  activePill: { backgroundColor: "#e8f5ee" },
  lockedPill: { backgroundColor: Colors.softRed },
  statusText: { fontWeight: "900", textTransform: "capitalize" },
  activeText: { color: Colors.basil },
  lockedText: { color: Colors.tomatoDark },
  planList: { gap: 10 },
  planCard: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, gap: 10 },
  planCardActive: { borderColor: Colors.tomato, backgroundColor: Colors.softRed },
  planTop: { flexDirection: "row", gap: 12 },
  planName: { color: Colors.ink, fontWeight: "900", fontSize: 17 },
  planDescription: { color: Colors.muted, lineHeight: 19, marginTop: 3 },
  priceBox: { alignItems: "flex-end", minWidth: 72 },
  price: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  pricePeriod: { color: Colors.muted, fontWeight: "700", fontSize: 12 },
  planFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  planBadge: { color: Colors.basil, fontWeight: "900", flex: 1 },
  codeBox: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, gap: 8 },
  codeTitle: { color: Colors.ink, fontWeight: "900" },
  actions: { flexDirection: "row", gap: 10, flexWrap: "wrap", alignItems: "center" },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, backgroundColor: Colors.surface, flex: 1, color: Colors.ink },
  dateInput: { textAlign: "center", fontWeight: "900", minWidth: 118, paddingHorizontal: 4 },
  dateArrow: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, backgroundColor: Colors.border },
  lockedBox: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, gap: 6 },
  lockedTitle: { color: Colors.ink, fontWeight: "900" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { flexGrow: 1, flexShrink: 0, maxWidth: "100%", borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 10 },
  metricValue: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  metricLabel: { color: Colors.muted, fontWeight: "800", fontSize: 12 },
  targetBox: { borderTopWidth: 1, borderColor: Colors.border, paddingTop: 12, gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  field: { flexBasis: "45%", flexGrow: 1, minWidth: 0, gap: 4 },
  fieldLabel: { color: Colors.ink, fontWeight: "700", fontSize: 14 },
  viewBox: { borderTopWidth: 1, borderColor: Colors.border, paddingTop: 12, gap: 8 },
  dayHeader: { flexDirection: "row", alignItems: "center", gap: 4 },
  entryForm: { paddingVertical: 8, gap: 8 },
  entryList: { gap: 8 },
  entryRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, gap: 8 },
  entryTitle: { color: Colors.ink, fontWeight: "900", fontSize: 15 },
  editText: { color: Colors.tomatoDark, fontWeight: "900" },
  dayGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayCard: { flexBasis: "30%", flexGrow: 1, minWidth: 100, minHeight: 104, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 10, justifyContent: "space-between" },
  dayName: { color: Colors.ink, fontWeight: "900" },
  dayCalories: { color: Colors.tomatoDark, fontWeight: "900", fontSize: 20 },
  miniLabel: { color: Colors.muted, fontWeight: "800", fontSize: 11, textTransform: "uppercase" },
  miniText: { color: Colors.muted, fontSize: 12 },
  calendarRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  calendarLabel: { minWidth: 58 },
  calendarTrack: { flex: 1, height: 12, borderRadius: 999, backgroundColor: Colors.softRed, overflow: "hidden" },
  calendarFill: { height: "100%", backgroundColor: Colors.tomato },
  calendarValue: { minWidth: 52, flexShrink: 0, textAlign: "right", color: Colors.ink, fontWeight: "900" },
  analyticsList: { gap: 8 },
  macroLine: { borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: 8 },
  macroLineLabel: { color: Colors.ink, fontWeight: "900" },
  macroLineValue: { color: Colors.muted, marginTop: 2 },
  status: { color: Colors.basil, fontWeight: "700" },
  error: { color: Colors.danger, fontWeight: "700" },
  queryStatus: { gap: 8 }
});
