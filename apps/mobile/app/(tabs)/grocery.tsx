import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { useTransientMessage } from "@/components/useTransientMessage";
import { Screen } from "@/components/Screen";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { apiFetch as remoteFetch } from "@/services/api";
import { useSpace } from "@/features/groups/useSpace";
import { SpaceSelector } from "@/features/groups/SpaceSelector";
import { TourTarget } from "@/features/onboarding/TourTarget";
import { PantryCoverageEditor, PantrySelection } from "@/features/grocery/PantryCoverageEditor";
import { convertWeight, formatWeight, weightFactor, WeightUnit } from "@/services/weightUnits";
import { useMeasurementUnits } from "@/services/measurementPreferences";

type GroceryItem = {
  id: string;
  normalized_name?: string;
  display_name: string;
  quantity: number | null;
  required_quantity?: number | null;
  unit: string | null;
  category: string;
  is_checked: boolean;
  walmart_search_url?: string;
  retailer_display_name?: string;
  retailer_search_url?: string;
  match_status: string;
  notes?: string | null;
  recipe_quantity?: number | null;
  recipe_count?: number;
};
type PantryItem = { id: string; normalized_name: string; category: string; coverage_mode?: string; quantity?: number | null; unit?: string | null; week_start?: string | null; needs_confirmation?: boolean };
type RecipeGroup = { recipe_id: string | null; recipe_name: string; items: GroceryItem[] };
type GroceryListResponse = { items: GroceryItem[]; recipe_groups?: RecipeGroup[]; retailer_display_name?: string; pantry_coverage_version?: number };
type GroceryMode = "list" | "add" | "pantry";

export default function GroceryScreen() {
  const space = useSpace();
  return <GroceryContent key={space.key} />;
}

function GroceryContent() {
  const space = useSpace();
  const apiFetch = <T,>(path: string, init?: RequestInit) => init ? remoteFetch<T>(space.path(path), init) : remoteFetch<T>(space.path(path));
  const weightUnit = useMeasurementUnits().ingredient_weight;
  const queryClient = useQueryClient();
  const [status, setStatus] = useTransientMessage();
  const [mode, setMode] = useState<GroceryMode>("list");
  const params = useLocalSearchParams<{ mode?: string; tour?: string }>();
  useEffect(() => {
    if (params.mode === "list" || params.mode === "add" || params.mode === "pantry") setMode(params.mode);
  }, [params.mode, params.tour]);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [manualName, setManualName] = useState("");
  const [manualQty, setManualQty] = useState("");
  const [manualUnit, setManualUnit] = useState("");
  const [pantryName, setPantryName] = useState("");
  const [pantrySelection, setPantrySelection] = useState<PantrySelection | null>(null);
  const { data, error: loadError } = useQuery<GroceryListResponse>({ queryKey: space.queryKey("grocery"), queryFn: () => apiFetch<GroceryListResponse>("/api/v1/grocery-lists/current"), enabled: !space.isLoading && !space.isError, refetchInterval: space.groupId ? 30_000 : false });
  const { data: pantry } = useQuery<PantryItem[]>({ queryKey: space.queryKey("pantry"), queryFn: () => apiFetch<PantryItem[]>("/api/v1/grocery-lists/pantry"), enabled: !space.isLoading && !space.isError, refetchInterval: space.groupId ? 30_000 : false });
  const list = data as GroceryListResponse | undefined;
  const pantryReady = list?.pantry_coverage_version === 1;
  const grouped = useMemo<RecipeGroup[]>(() => {
    if (!list) return [];
    if (!list.recipe_groups) return list.items.length ? [{ recipe_id: null, recipe_name: "Shopping items", items: list.items }] : [];
    const shopping = new Map(list.items.map(item => [item.id, item]));
    // The canonical rows also contain queued offline edits shared by all recipe groups.
    return list.recipe_groups.map(group => ({ ...group, items: group.items.filter(item => shopping.has(item.id)).map(item => ({ ...item, ...shopping.get(item.id) })) }));
  }, [list]);
  const refreshPantry = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pantry"] }),
      queryClient.invalidateQueries({ queryKey: ["grocery"] })
    ]);
  };
  const itemsLeft = data?.items.filter((item: GroceryItem) => !item.is_checked && item.quantity !== 0).length ?? 0;
  const regen = useMutation({
    mutationFn: () => apiFetch("/api/v1/grocery-lists/current/regenerate", { method: "POST" }),
    onSuccess: async () => {
      setStatus("List regenerated from this week.");
      setMode("list");
      await queryClient.invalidateQueries({ queryKey: ["grocery"] });
    }
  });
  const patchItem = useMutation({
    mutationFn: ({ item, patch }: { item: GroceryItem; patch: Partial<GroceryItem> }) =>
      apiFetch(`/api/v1/grocery-lists/items/${item.id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["grocery"] })
  });
  const deleteItem = useMutation({
    mutationFn: (item: GroceryItem) => apiFetch(`/api/v1/grocery-lists/items/${item.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setStatus("Item removed.");
      await queryClient.invalidateQueries({ queryKey: ["grocery"] });
    }
  });
  const addManual = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/grocery-lists/current/items", {
        method: "POST",
        body: JSON.stringify({
          display_name: manualName,
          quantity: manualQty ? Number(manualQty) : null,
          unit: manualUnit || null,
          category: "household"
        })
      }),
    onSuccess: async () => {
      setManualName("");
      setManualQty("");
      setManualUnit("");
      setStatus("Household item added.");
      setMode("list");
      await queryClient.invalidateQueries({ queryKey: ["grocery"] });
    }
  });
  const deletePantry = useMutation({
    mutationFn: (item: PantryItem) => apiFetch(`/api/v1/grocery-lists/pantry/${item.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setStatus("Removed from pantry. Shopping list updated.");
      await refreshPantry();
    }
  });
  const error = [loadError, regen.error, patchItem.error, deleteItem.error, addManual.error, deletePantry.error].find(Boolean);
  if (space.isLoading || space.isError) return <Screen contentWidth={960} header={<Text style={styles.title}>Grocery List</Text>}><Text style={styles.subtitle}>{space.isError ? "Couldn't load your kitchen." : "Loading your kitchen..."}</Text>{space.isError ? <Button label="Retry kitchen" icon="refresh" onPress={() => { void space.refetch(); }} /> : null}</Screen>;
  return (
    <Screen contentWidth={960} header={
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Grocery List</Text>
          <Text style={styles.subtitle}>{itemsLeft} left to grab • {data?.retailer_display_name ?? "Walmart"} links</Text>
        </View>
        <Button label="" accessibilityLabel="Regenerate groceries" icon="sync" onPress={() => regen.mutate()} />
      </View>}>
      <SpaceSelector label="Shopping for" />
      {status ? <Text style={styles.status}>{status}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: Colors.danger, marginBottom: 10 }}>{error.message}</Text> : null}
      <TourTarget id="grocery-list"><SegmentedControl
        accessibilityLabel="Grocery sections"
        value={mode}
        onChange={setMode}
        options={[
          { label: "List", value: "list" },
          { label: "Add", value: "add" },
          { label: "Pantry", value: "pantry" }
        ]}
      /></TourTarget>
      {mode === "add" ? (
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Add household item</Text>
        <TextInput accessibilityLabel="Manual item name" value={manualName} onChangeText={setManualName} placeholder="Paper towels, foil, dish soap" style={styles.input} />
        <View style={styles.inputRow}>
          <TextInput accessibilityLabel="Manual item quantity" value={manualQty} onChangeText={setManualQty} keyboardType="decimal-pad" placeholder="Qty" style={[styles.input, styles.smallInput]} />
          <TextInput accessibilityLabel="Manual item unit" value={manualUnit} onChangeText={setManualUnit} placeholder="Unit" style={[styles.input, styles.smallInput]} />
          <Button label="Add" icon="add" variant="primary" onPress={() => addManual.mutate()} />
        </View>
      </View>
      ) : null}
      {mode === "pantry" ? (
      <TourTarget id="grocery-pantry"><View style={styles.panel}>
        <Text style={styles.sectionTitle}>In pantry</Text>
        {!pantryReady ? <Text style={styles.meta}>Pantry updates are temporarily unavailable.</Text> : null}
        <View style={styles.inputRow}>
          <TextInput accessibilityLabel="Pantry item" value={pantryName} onChangeText={setPantryName} placeholder="Salt, olive oil, rice" style={styles.input} />
          <Button label="Add" icon="add" disabled={!pantryReady || !pantryName.trim()} onPress={() => setPantrySelection({ name: pantryName.trim(), normalizedName: pantryName.trim(), category: "pantry" })} />
        </View>
        <View style={styles.chips}>
          {(pantry ?? []).map((item: PantryItem) => (
            <View key={item.id} style={styles.pantryRow}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Update ${item.normalized_name} pantry`} disabled={!pantryReady} style={{ flex: 1, gap: 3 }} onPress={() => setPantrySelection({ name: item.normalized_name, normalizedName: item.normalized_name, category: item.category, stockQuantity: item.quantity, stockUnit: item.unit })}>
                <Text style={styles.pantryText}>{item.normalized_name}</Text>
                <Text style={styles.meta}>{item.coverage_mode === "quantity" ? `${formatQuantity({ quantity: item.quantity ?? null, unit: item.unit ?? null }, weightUnit)} on hand` : item.needs_confirmation ? "Confirm this week's coverage" : item.coverage_mode === "enough" ? "Enough for this week's meals" : "Confirm stock amount"}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.normalized_name} from pantry`} disabled={deletePantry.isPending} onPress={() => deletePantry.mutate(item)} style={styles.removePantry}>
                <Ionicons name="trash-outline" size={20} color={Colors.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      </View></TourTarget>
      ) : null}
      {mode === "list" ? grouped.map((group) => {
        const key = group.recipe_id ?? "additional";
        const collapsed = collapsedGroups.has(key);
        return (
        <View key={key} style={styles.group}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${group.recipe_name}`} accessibilityState={{ expanded: !collapsed }} style={styles.groupHeader} onPress={() => setCollapsedGroups(previous => {
            const next = new Set(previous);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
          })}>
            <Ionicons name={collapsed ? "chevron-forward" : "chevron-down"} size={20} color={Colors.basil} />
            <Text style={styles.groupName}>{group.recipe_name}</Text>
            <Text style={styles.meta}>{group.items.filter(item => !item.is_checked && item.quantity !== 0).length} left</Text>
          </Pressable>
          {!collapsed ? group.items.map((item) => {
            const isExpanded = expandedItemId === item.id;
            return (
            <View key={item.id} style={[styles.item, isExpanded ? styles.itemExpanded : null]}>
              <View style={styles.itemTop}>
              <Pressable accessibilityRole="checkbox" accessibilityLabel={item.display_name} aria-checked={item.is_checked} accessibilityState={{ checked: item.is_checked }} onPress={() => patchItem.mutate({ item, patch: { is_checked: !item.is_checked } })} style={styles.checkboxTarget}>
                <View style={[styles.checkbox, item.is_checked && styles.checkboxChecked]}>{item.is_checked ? <Ionicons name="checkmark" size={19} color="#fff" /> : null}</View>
              </Pressable>
              <View style={styles.itemBody}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.display_name}`} onPress={() => setExpandedItemId(isExpanded ? null : item.id)} style={styles.itemSummary}>
                  <Text style={[styles.name, item.is_checked && styles.checked]}>{item.display_name}</Text>
                  <Text style={styles.meta}>{item.recipe_quantity !== undefined ? `Recipe: ${formatQuantity({ ...item, quantity: item.recipe_quantity }, weightUnit)}` : formatQuantity(item, weightUnit)}</Text>
                  {(item.recipe_count ?? 0) > 1 ? <Text style={styles.meta}>Buy total: {formatQuantity(item, weightUnit)}</Text> : null}
                  {item.notes ? <Text style={styles.meta}>{item.notes}</Text> : null}
                </Pressable>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Put ${item.display_name} in pantry`} accessibilityState={{ disabled: !pantryReady }} disabled={!pantryReady} style={[styles.pantryAction, !pantryReady && { opacity: 0.45 }]} onPress={() => {
                const stored = (pantry as PantryItem[] | undefined)?.find(row => row.normalized_name === item.normalized_name);
                setPantrySelection({ itemId: item.id, name: item.display_name, normalizedName: item.normalized_name ?? item.display_name, category: item.category, requiredQuantity: item.required_quantity !== undefined ? item.required_quantity : item.quantity, unit: item.unit, stockQuantity: stored?.quantity, stockUnit: stored?.unit });
              }}>
                <Ionicons name="file-tray-outline" color={Colors.basil} size={20} />
                <Text style={styles.pantryActionText}>In Pantry</Text>
              </Pressable>
              </View>
                {isExpanded ? (
                  <>
                  <Text style={styles.meta}>Buy total: {formatQuantity(item, weightUnit)}</Text>
                  <View style={styles.itemControls}>
                  <Button label="" icon="remove" accessibilityLabel={`Decrease ${item.display_name} quantity`} disabled={patchItem.isPending || item.quantity === 0} onPress={() => patchItem.mutate({ item, patch: { quantity: Math.max(0, (item.quantity ?? 1) - quantityStep(item.unit, weightUnit)) } })} />
                  <Button label="" icon="add" accessibilityLabel={`Increase ${item.display_name} quantity`} disabled={patchItem.isPending} onPress={() => patchItem.mutate({ item, patch: { quantity: (item.quantity ?? 0) + quantityStep(item.unit, weightUnit) } })} />
                  {retailerUrl(item) ? (
                    <Button
                      label={item.retailer_display_name ?? data?.retailer_display_name ?? "Walmart"}
                      icon="search"
                      onPress={() => Linking.openURL(retailerUrl(item)!)}
                    />
                  ) : null}
                  <Button label="Delete" icon="trash" variant="danger" onPress={() => deleteItem.mutate(item)} />
                  </View>
                  </>
                ) : null}
            </View>
            );
          }) : null}
        </View>
      ); }) : null}
      {mode === "list" && data && !data.items?.length ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>No grocery items yet</Text>
          <Text style={styles.empty}>Choose meals or add a household item, then regenerate the list.</Text>
          </View>
      ) : null}
      {pantrySelection ? <PantryCoverageEditor householdId={space.groupId} selection={pantrySelection} onClose={() => setPantrySelection(null)} onSaved={coverage => {
        setPantrySelection(null); setPantryName(""); setExpandedItemId(null);
        setStatus(coverage === "enough" ? "Covered for this week's meals." : "Pantry updated. Shopping amounts recalculated.");
      }} /> : null}
    </Screen>
  );
}

function formatQuantity(item: { quantity: number | null; unit: string | null }, target: WeightUnit | null) {
  if (item.quantity === null) return item.unit ? item.unit : "Quantity needs review";
  const converted = target ? convertWeight(item.quantity, item.unit, target) : null;
  if (converted !== null && target) return `${formatWeight(converted, target)} ${target}`;
  return `${Number(item.quantity.toFixed(2))} ${item.unit ?? ""}`.trim();
}

function quantityStep(unit: string | null, target: WeightUnit | null) {
  const factor = weightFactor(unit);
  return factor !== null && target ? weightFactor(target)! / factor : 1;
}

function retailerUrl(item: GroceryItem) {
  return item.retailer_search_url ?? item.walmart_search_url ?? null;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: 8, justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 28, fontWeight: "900", color: Colors.ink },
  subtitle: { color: Colors.muted },
  status: { color: Colors.basil, fontWeight: "800", marginBottom: 8 },
  panel: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, gap: 10, marginTop: 12, marginBottom: 12 },
  sectionTitle: { color: Colors.ink, fontSize: 18, fontWeight: "900" },
  inputRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  input: { minHeight: 48, flex: 1, minWidth: 130, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, backgroundColor: Colors.surface },
  smallInput: { minWidth: 74, flex: 0.5 },
  chips: { gap: 8 },
  pantryRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 56, borderBottomWidth: 1, borderColor: Colors.border, paddingVertical: 8 },
  removePantry: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  pantryChip: { flexDirection: "row", gap: 7, alignItems: "center", borderRadius: 999, backgroundColor: Colors.softRed, paddingHorizontal: 10, minHeight: 34 },
  pantryText: { color: Colors.tomatoDark, fontWeight: "800", textTransform: "capitalize" },
  pantryRemove: { color: Colors.tomatoDark, fontWeight: "900", fontSize: 16 },
  group: { marginTop: 12, gap: 8 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  groupName: { flex: 1, fontSize: 18, fontWeight: "900", color: Colors.ink },
  item: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, gap: 8 },
  itemTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  pantryAction: { minHeight: 44, width: 68, alignItems: "center", justifyContent: "center", gap: 3 },
  pantryActionText: { fontSize: 12, fontWeight: "800", color: Colors.basil },
  itemExpanded: { borderColor: "#f0b6b2" },
  checkboxTarget: { width: 44, minHeight: 44, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  checkbox: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: Colors.basil, borderColor: Colors.basil },
  itemBody: { flex: 1, minWidth: 0, gap: 1 },
  itemSummary: { minHeight: 44, gap: 1 },
  name: { fontSize: 17, fontWeight: "800", color: Colors.ink },
  checked: { textDecorationLine: "line-through", color: Colors.muted },
  meta: { color: Colors.muted, marginTop: 2 },
  itemControls: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  emptyPanel: { alignItems: "center", paddingVertical: 24, gap: 8 },
  emptyTitle: { color: Colors.ink, fontWeight: "900", fontSize: 20 },
  empty: { color: Colors.muted, textAlign: "center" }
});
