import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import {
  MacroAnalytics,
  MacroConfirmation,
  MacroExport,
  MacroSummary,
  MacroTarget,
  PremiumStatus,
  SubscriptionPlanStatus,
  SubscriptionTier
} from "@/services/types";

type MacroView = "day" | "grid" | "calendar" | "analytics";
type MealLabel = "breakfast" | "lunch" | "dinner" | "snack";

const MEAL_LABEL_OPTIONS: { label: string; value: MealLabel }[] = [
  { label: "Breakfast", value: "breakfast" },
  { label: "Lunch", value: "lunch" },
  { label: "Dinner", value: "dinner" },
  { label: "Snack", value: "snack" }
];

export function PremiumMacroPanel() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [goal, setGoal] = useState("");
  const [macroView, setMacroView] = useState<MacroView>("day");
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

  const subscription = useQuery({
    queryKey: ["subscription-status"],
    queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"),
    retry: false
  });
  const premiumActive = Boolean(subscription.data?.premium_active ?? subscription.data?.active);
  const summary = useQuery({
    queryKey: ["macro-summary"],
    queryFn: () => apiFetch<MacroSummary>("/api/v1/macros/summary?days=7"),
    enabled: premiumActive,
    retry: false
  });
  const targets = useQuery({
    queryKey: ["macro-targets"],
    queryFn: () => apiFetch<MacroTarget>("/api/v1/macros/targets"),
    enabled: premiumActive,
    retry: false
  });
  const entries = useQuery({
    queryKey: ["macro-entries"],
    queryFn: () => apiFetch<MacroConfirmation[]>("/api/v1/macros/entries?days=30"),
    enabled: premiumActive,
    retry: false
  });
  const analytics = useQuery({
    queryKey: ["macro-analytics"],
    queryFn: () => apiFetch<MacroAnalytics>("/api/v1/macros/analytics?days=30"),
    enabled: premiumActive,
    retry: false
  });
  const basicPlan = useMemo(
    () => subscription.data?.plans.find((plan: SubscriptionPlanStatus) => plan.tier === "basic"),
    [subscription.data?.plans]
  );
  const premiumPlan = useMemo(
    () => subscription.data?.plans.find((plan: SubscriptionPlanStatus) => plan.tier === "premium"),
    [subscription.data?.plans]
  );
  const selectedEntries = useMemo(
    () => (entries.data ?? []).filter((entry: MacroConfirmation) => entry.meal_date === selectedDate),
    [entries.data, selectedDate]
  );
  const selectedTotal = useMemo(
    () => analytics.data?.daily_totals.find((day: MacroAnalytics["daily_totals"][number]) => day.meal_date === selectedDate),
    [analytics.data?.daily_totals, selectedDate]
  );

  useEffect(() => {
    if (!targets.data) return;
    setCalories(valueToInput(targets.data.daily_calories));
    setProtein(valueToInput(targets.data.daily_protein_g));
    setCarbs(valueToInput(targets.data.daily_carbs_g));
    setFat(valueToInput(targets.data.daily_fat_g));
    setGoal(targets.data.goal ?? "");
  }, [targets.data]);

  const applyCode = useMutation({
    mutationFn: () =>
      apiFetch<PremiumStatus>("/api/v1/subscription/waiver-code", {
        method: "POST",
        body: JSON.stringify({ code })
      }),
    onSuccess: async (data) => {
      setCode("");
      setStatus(data.premium_active ? "Premium access unlocked." : "Basic access unlocked.");
      await refreshPremium(queryClient);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to apply code.")
  });

  const startCheckout = useMutation({
    mutationFn: (tier: SubscriptionTier) =>
      apiFetch<{ checkout_url: string }>("/api/v1/subscription/checkout-session", {
        method: "POST",
        body: JSON.stringify({ tier })
      }),
    onSuccess: async (data) => {
      setStatus("Opening checkout.");
      await Linking.openURL(data.checkout_url);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to start checkout.")
  });

  const manageBilling = useMutation({
    mutationFn: () =>
      apiFetch<{ portal_url: string }>("/api/v1/premium/billing-portal-session", {
        method: "POST"
      }),
    onSuccess: async (data) => {
      setStatus("Opening billing portal.");
      await Linking.openURL(data.portal_url);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to open billing.")
  });

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
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to save targets.")
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
      setStatus(editingEntryId ? "Macro entry updated." : "Macro entry added.");
      clearEntryForm();
      await refreshPremium(queryClient);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to save macro entry.")
  });

  const deleteEntry = useMutation({
    mutationFn: (entryId: string) =>
      apiFetch<{ status: string }>(`/api/v1/macros/entries/${entryId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setStatus("Macro entry removed.");
      clearEntryForm();
      await refreshPremium(queryClient);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to remove macro entry.")
  });

  const exportMacros = useMutation({
    mutationFn: () => apiFetch<MacroExport>("/api/v1/macros/export?days=30"),
    onSuccess: async (data) => {
      await deliverMacroExport(data);
      setStatus("Macro export generated.");
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to export macros.")
  });

  function beginEdit(entry: MacroConfirmation) {
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

  const currentTier = subscription.data?.current_tier ?? "none";
  const trialDays = subscription.data?.trial_days_remaining ?? 0;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.section}>Subscription</Text>
          <Text style={styles.meta}>{tierSummary(currentTier, trialDays)}</Text>
        </View>
        <View style={[styles.statusPill, premiumActive ? styles.activePill : styles.lockedPill]}>
          <Text style={[styles.statusText, premiumActive ? styles.activeText : styles.lockedText]}>
            {currentTier === "none" ? "Inactive" : currentTier}
          </Text>
        </View>
      </View>

      <View style={styles.planList}>
        <PlanCard
          name="Basic"
          plan={basicPlan}
          fallbackPriceCents={subscription.data?.basic_monthly_price_cents ?? 599}
          fallbackDescription="Recipe saving, weekly plans, grocery lists, group voting, and web recipe imports."
          active={Boolean(subscription.data?.basic_active) && !premiumActive}
          badge={subscription.data?.trial_active ? `${trialDays} trial days left` : "Card required for trial"}
          actionLabel={subscription.data?.basic_active ? "Current" : "Start Basic"}
          disabled={Boolean(subscription.data?.basic_active) || !subscription.data?.basic_stripe_configured || startCheckout.isPending}
          onPress={() => startCheckout.mutate("basic")}
        />
        <PlanCard
          name="Premium"
          plan={premiumPlan}
          fallbackPriceCents={subscription.data?.premium_monthly_price_cents ?? 999}
          fallbackDescription="Everything in Basic plus daily macros, planned-meal logging, analytics, and exports."
          active={premiumActive}
          badge="Macro tracking"
          actionLabel={premiumActive ? "Current" : "Upgrade"}
          disabled={premiumActive || !subscription.data?.premium_stripe_configured || startCheckout.isPending}
          onPress={() => startCheckout.mutate("premium")}
        />
      </View>

      <View style={styles.codeBox}>
        <Text style={styles.codeTitle}>Testing access code</Text>
        <View style={styles.actions}>
          <TextInput
            autoCapitalize="none"
            accessibilityLabel="Subscription access code"
            value={code}
            onChangeText={setCode}
            placeholder="Access code"
            placeholderTextColor="#9b928b"
            style={styles.input}
          />
          <Button
            label="Apply"
            icon="ticket"
            variant="primary"
            disabled={applyCode.isPending || code.trim().length < 3}
            onPress={() => applyCode.mutate()}
          />
        </View>
      </View>

      {subscription.data?.billing_management_available ? (
        <Button
          label="Manage billing"
          icon="card"
          disabled={manageBilling.isPending}
          onPress={() => manageBilling.mutate()}
        />
      ) : null}

      <View style={styles.divider} />
      <Text style={styles.section}>Premium macros</Text>
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
          <View style={styles.metrics}>
            <Metric label="Meals" value={String(summary.data?.eaten_meals ?? 0)} />
            <Metric label="Protein" value={`${summary.data?.totals.protein_g ?? 0}g`} />
            <Metric label="Calories" value={String(summary.data?.totals.calories ?? 0)} />
          </View>

          <View style={styles.targetBox}>
            <Text style={styles.subsection}>Targets</Text>
            <View style={styles.grid}>
              <TextInput accessibilityLabel="Daily calories target" value={calories} onChangeText={setCalories} keyboardType="number-pad" placeholder="Calories" style={[styles.input, styles.gridInput]} />
              <TextInput accessibilityLabel="Daily protein target" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" placeholder="Protein g" style={[styles.input, styles.gridInput]} />
              <TextInput accessibilityLabel="Daily carbs target" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" placeholder="Carbs g" style={[styles.input, styles.gridInput]} />
              <TextInput accessibilityLabel="Daily fat target" value={fat} onChangeText={setFat} keyboardType="decimal-pad" placeholder="Fat g" style={[styles.input, styles.gridInput]} />
            </View>
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

          {macroView === "day" ? (
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
              savePending={saveEntry.isPending}
              deletePending={deleteEntry.isPending}
              onSave={() => saveEntry.mutate()}
              onClear={clearEntryForm}
              onDelete={() => editingEntryId ? deleteEntry.mutate(editingEntryId) : undefined}
              onEdit={beginEdit}
            />
          ) : null}

          {macroView === "grid" ? (
            <GridMacroView dailyTotals={analytics.data?.daily_totals ?? []} onPickDay={(day) => {
              setSelectedDate(day);
              setMacroView("day");
            }} />
          ) : null}

          {macroView === "calendar" ? (
            <CalendarMacroView dailyTotals={analytics.data?.daily_totals ?? []} targetCalories={targets.data?.daily_calories ?? null} />
          ) : null}

          {macroView === "analytics" ? (
            <AnalyticsMacroView
              analytics={analytics.data}
              exportPending={exportMacros.isPending}
              onExport={() => exportMacros.mutate()}
            />
          ) : null}
        </>
      )}
      {summary.data?.unmatched_meals ? <Text style={styles.meta}>{summary.data.unmatched_meals} meals need macro review.</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
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
  deletePending,
  onSave,
  onClear,
  onDelete,
  onEdit
}: {
  selectedDate: string;
  setSelectedDate: (value: string) => void;
  selectedTotal?: MacroAnalytics["daily_totals"][number];
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
  deletePending: boolean;
  onSave: () => void;
  onClear: () => void;
  onDelete: () => void;
  onEdit: (entry: MacroConfirmation) => void;
}) {
  return (
    <View style={styles.viewBox}>
      <View style={styles.dayHeader}>
        <Button label="Prev" icon="chevron-back" onPress={() => setSelectedDate(shiftISODate(selectedDate, -1))} />
        <TextInput accessibilityLabel="Macro date" value={selectedDate} onChangeText={setSelectedDate} style={[styles.input, styles.dateInput]} />
        <Button label="Next" icon="chevron-forward" onPress={() => setSelectedDate(shiftISODate(selectedDate, 1))} />
      </View>
      <View style={styles.metrics}>
        <Metric label="Calories" value={String(selectedTotal?.calories ?? 0)} />
        <Metric label="Protein" value={`${selectedTotal?.protein_g ?? 0}g`} />
        <Metric label="Entries" value={String(selectedTotal?.entry_count ?? 0)} />
      </View>

      <View style={styles.entryForm}>
        <Text style={styles.subsection}>{editingEntryId ? "Edit entry" : "Add macro entry"}</Text>
        <TextInput accessibilityLabel="Entry name" value={entryName} onChangeText={setEntryName} placeholder="Meal, snack, or item" style={styles.input} />
        <SegmentedControl accessibilityLabel="Meal label" value={mealLabel} onChange={setMealLabel} options={MEAL_LABEL_OPTIONS} />
        <View style={styles.grid}>
          <TextInput accessibilityLabel="Calories" value={entryCalories} onChangeText={setEntryCalories} keyboardType="number-pad" placeholder="Calories" style={[styles.input, styles.gridInput]} />
          <TextInput accessibilityLabel="Protein grams" value={entryProtein} onChangeText={setEntryProtein} keyboardType="decimal-pad" placeholder="Protein g" style={[styles.input, styles.gridInput]} />
          <TextInput accessibilityLabel="Carbs grams" value={entryCarbs} onChangeText={setEntryCarbs} keyboardType="decimal-pad" placeholder="Carbs g" style={[styles.input, styles.gridInput]} />
          <TextInput accessibilityLabel="Fat grams" value={entryFat} onChangeText={setEntryFat} keyboardType="decimal-pad" placeholder="Fat g" style={[styles.input, styles.gridInput]} />
          <TextInput accessibilityLabel="Fiber grams" value={entryFiber} onChangeText={setEntryFiber} keyboardType="decimal-pad" placeholder="Fiber g" style={[styles.input, styles.gridInput]} />
        </View>
        <TextInput accessibilityLabel="Entry notes" value={entryNotes} onChangeText={setEntryNotes} placeholder="Notes" style={styles.input} />
        <View style={styles.actions}>
          <Button label={editingEntryId ? "Update" : "Add"} icon={editingEntryId ? "save" : "add-circle"} variant="primary" disabled={savePending || !entryName.trim()} onPress={onSave} />
          <Button label="Clear" icon="close" onPress={onClear} />
          {editingEntryId ? <Button label="Delete" icon="trash" variant="danger" disabled={deletePending} onPress={onDelete} /> : null}
        </View>
      </View>

      <View style={styles.entryList}>
        <Text style={styles.subsection}>Logged today</Text>
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
            <Text style={styles.miniText}>{day.protein_g}g protein</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function CalendarMacroView({
  dailyTotals,
  targetCalories
}: {
  dailyTotals: MacroAnalytics["daily_totals"];
  targetCalories: number | null;
}) {
  const recent = dailyTotals.slice(-14);
  return (
    <View style={styles.viewBox}>
      <Text style={styles.subsection}>Calendar view</Text>
      {recent.map((day) => {
        const percent = targetCalories ? Math.min(100, Math.round((day.calories / targetCalories) * 100)) : 0;
        return (
          <View key={day.meal_date} style={styles.calendarRow}>
            <View style={styles.calendarLabel}>
              <Text style={styles.dayName}>{shortDate(day.meal_date)}</Text>
              <Text style={styles.miniText}>{day.entry_count} entries</Text>
            </View>
            <View style={styles.calendarTrack}>
              <View style={[styles.calendarFill, { width: `${targetCalories ? percent : Math.min(100, day.entry_count * 24)}%` }]} />
            </View>
            <Text style={styles.calendarValue}>{day.calories}</Text>
          </View>
        );
      })}
    </View>
  );
}

function AnalyticsMacroView({
  analytics,
  exportPending,
  onExport
}: {
  analytics?: MacroAnalytics;
  exportPending: boolean;
  onExport: () => void;
}) {
  return (
    <View style={styles.viewBox}>
      <Text style={styles.subsection}>30-day analytics</Text>
      <View style={styles.metrics}>
        <Metric label="Days logged" value={String(analytics?.days_logged ?? 0)} />
        <Metric label="Avg calories" value={String(analytics?.averages.calories ?? 0)} />
        <Metric label="Avg protein" value={`${analytics?.averages.protein_g ?? 0}g`} />
      </View>
      <View style={styles.analyticsList}>
        <MacroLine label="Calories" value={analytics?.totals.calories ?? 0} target={analytics?.targets.daily_calories ?? null} />
        <MacroLine label="Protein" value={analytics?.totals.protein_g ?? 0} target={analytics?.targets.daily_protein_g ?? null} suffix="g" />
        <MacroLine label="Carbs" value={analytics?.totals.carbs_g ?? 0} target={analytics?.targets.daily_carbs_g ?? null} suffix="g" />
        <MacroLine label="Fat" value={analytics?.totals.fat_g ?? 0} target={analytics?.targets.daily_fat_g ?? null} suffix="g" />
      </View>
      <Button label="Export analytics" icon="download" variant="primary" disabled={exportPending} onPress={onExport} />
    </View>
  );
}

function PlanCard({
  name,
  plan,
  fallbackPriceCents,
  fallbackDescription,
  active,
  badge,
  actionLabel,
  disabled,
  onPress
}: {
  name: string;
  plan?: SubscriptionPlanStatus;
  fallbackPriceCents: number;
  fallbackDescription: string;
  active: boolean;
  badge: string;
  actionLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const price = plan?.monthly_price_cents ?? fallbackPriceCents;
  return (
    <View style={[styles.planCard, active ? styles.planCardActive : null]}>
      <View style={styles.planTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.planName}>{plan?.display_name ?? name}</Text>
          <Text style={styles.planDescription}>{plan?.description ?? fallbackDescription}</Text>
        </View>
        <View style={styles.priceBox}>
          <Text style={styles.price}>${(price / 100).toFixed(2)}</Text>
          <Text style={styles.pricePeriod}>/mo</Text>
        </View>
      </View>
      <View style={styles.planFooter}>
        <Text style={styles.planBadge}>{active ? "Active" : badge}</Text>
        <Button label={actionLabel} icon={active ? "checkmark" : "card"} disabled={disabled} onPress={onPress} />
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function EntryRow({ entry, onPress }: { entry: MacroConfirmation; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.entryRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.entryTitle}>{entry.entry_name ?? entry.recipe_name ?? "Macro entry"}</Text>
        <Text style={styles.meta}>
          {entry.meal_label ?? "meal"} - {entry.calories ?? 0} cal - {entry.protein_g ?? 0}g protein
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
  suffix = ""
}: {
  label: string;
  value: number;
  target?: number | null;
  suffix?: string;
}) {
  const targetText = target ? ` / ${target}${suffix} daily target` : "";
  return (
    <View style={styles.macroLine}>
      <Text style={styles.macroLineLabel}>{label}</Text>
      <Text style={styles.macroLineValue}>
        {value}
        {suffix}
        {targetText}
      </Text>
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

function tierSummary(currentTier: string, trialDays: number) {
  if (currentTier === "premium") return "Premium is active.";
  if (currentTier === "basic") return "Basic is active. Upgrade anytime for macro tracking.";
  if (currentTier === "trial") {
    return `Basic trial is active. ${trialDays} day${trialDays === 1 ? "" : "s"} left.`;
  }
  return "Start Basic with a card on file or choose Premium for macro tracking.";
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
  const filename = `dinner-swipe-macros-${todayISO()}.json`;
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

function normalizeMealLabel(value: string | null | undefined): MealLabel {
  if (value === "breakfast" || value === "lunch" || value === "snack") return value;
  return "dinner";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function shiftISODate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}

function shortDate(value: string) {
  const [, month, day] = value.split("-").map(Number);
  return `${month}/${day}`;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 12, marginBottom: 12 },
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
  dateInput: { textAlign: "center", fontWeight: "900" },
  divider: { height: 1, backgroundColor: Colors.border },
  lockedBox: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, gap: 6 },
  lockedTitle: { color: Colors.ink, fontWeight: "900" },
  metrics: { flexDirection: "row", gap: 8 },
  metric: { flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 10 },
  metricValue: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  metricLabel: { color: Colors.muted, fontWeight: "800", fontSize: 12 },
  targetBox: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridInput: { flex: 1, minWidth: 118 },
  viewBox: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, gap: 12 },
  dayHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  entryForm: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, gap: 10 },
  entryList: { gap: 8 },
  entryRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 10, gap: 10 },
  entryTitle: { color: Colors.ink, fontWeight: "900", fontSize: 15 },
  editText: { color: Colors.tomatoDark, fontWeight: "900" },
  dayGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayCard: { width: "31.5%", minHeight: 104, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 10, justifyContent: "space-between" },
  dayName: { color: Colors.ink, fontWeight: "900" },
  dayCalories: { color: Colors.tomatoDark, fontWeight: "900", fontSize: 20 },
  miniLabel: { color: Colors.muted, fontWeight: "800", fontSize: 11, textTransform: "uppercase" },
  miniText: { color: Colors.muted, fontSize: 12 },
  calendarRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  calendarLabel: { width: 58 },
  calendarTrack: { flex: 1, height: 12, borderRadius: 999, backgroundColor: Colors.softRed, overflow: "hidden" },
  calendarFill: { height: "100%", backgroundColor: Colors.tomato },
  calendarValue: { width: 52, textAlign: "right", color: Colors.ink, fontWeight: "900" },
  analyticsList: { gap: 8 },
  macroLine: { borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: 8 },
  macroLineLabel: { color: Colors.ink, fontWeight: "900" },
  macroLineValue: { color: Colors.muted, marginTop: 2 },
  status: { color: Colors.basil, fontWeight: "700" }
});
