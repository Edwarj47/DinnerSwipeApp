import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";

type GroceryItem = {
  id: string;
  display_name: string;
  quantity: number | null;
  unit: string | null;
  category: string;
  is_checked: boolean;
  walmart_search_url?: string;
  retailer_display_name?: string;
  retailer_search_url?: string;
  match_status: string;
  notes?: string | null;
};
type PantryItem = { id: string; normalized_name: string; category: string };
type GroceryListResponse = { items: GroceryItem[]; retailer_display_name?: string };
type GroceryMode = "list" | "add" | "pantry";

export default function GroceryScreen() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState<GroceryMode>("list");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualQty, setManualQty] = useState("");
  const [manualUnit, setManualUnit] = useState("");
  const [pantryName, setPantryName] = useState("");
  const { data } = useQuery<GroceryListResponse>({ queryKey: ["grocery"], queryFn: () => apiFetch<GroceryListResponse>("/api/v1/grocery-lists/current") });
  const { data: pantry } = useQuery<PantryItem[]>({ queryKey: ["pantry"], queryFn: () => apiFetch<PantryItem[]>("/api/v1/grocery-lists/pantry") });
  const grouped = useMemo(() => groupItems(data?.items ?? []), [data?.items]);
  const itemsLeft = data?.items.filter((item: GroceryItem) => !item.is_checked).length ?? 0;
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
  const addPantry = useMutation({
    mutationFn: () => apiFetch("/api/v1/grocery-lists/pantry", { method: "POST", body: JSON.stringify({ normalized_name: pantryName, category: "pantry" }) }),
    onSuccess: async () => {
      setPantryName("");
      setStatus("Pantry exclusion saved. Regenerate to apply it.");
      await queryClient.invalidateQueries({ queryKey: ["pantry"] });
    }
  });
  const deletePantry = useMutation({
    mutationFn: (item: PantryItem) => apiFetch(`/api/v1/grocery-lists/pantry/${item.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setStatus("Pantry exclusion removed.");
      await queryClient.invalidateQueries({ queryKey: ["pantry"] });
    }
  });
  return (
    <Screen>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Grocery List</Text>
          <Text style={styles.subtitle}>{itemsLeft} left to grab • {data?.retailer_display_name ?? "Walmart"} links</Text>
        </View>
        <Button label="Regenerate" icon="sync" onPress={() => regen.mutate()} />
      </View>
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <SegmentedControl
        accessibilityLabel="Grocery sections"
        value={mode}
        onChange={setMode}
        options={[
          { label: "List", value: "list" },
          { label: "Add", value: "add" },
          { label: "Pantry", value: "pantry" }
        ]}
      />
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
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Pantry exclusions</Text>
        <View style={styles.inputRow}>
          <TextInput accessibilityLabel="Pantry item" value={pantryName} onChangeText={setPantryName} placeholder="Salt, olive oil, rice" style={styles.input} />
          <Button label="Save" icon="bookmark" onPress={() => addPantry.mutate()} />
        </View>
        <View style={styles.chips}>
          {(pantry ?? []).map((item: PantryItem) => (
            <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Remove ${item.normalized_name} from pantry`} onPress={() => deletePantry.mutate(item)} style={styles.pantryChip}>
              <Text style={styles.pantryText}>{item.normalized_name}</Text>
              <Text style={styles.pantryRemove}>x</Text>
            </Pressable>
          ))}
        </View>
      </View>
      ) : null}
      {mode === "list" ? grouped.map(([category, items]) => (
        <View key={category} style={styles.group}>
          <Text style={styles.category}>{category}</Text>
          {items.map((item) => {
            const isExpanded = expandedItemId === item.id;
            return (
            <View key={item.id} style={[styles.item, isExpanded ? styles.itemExpanded : null]}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: item.is_checked }} onPress={() => patchItem.mutate({ item, patch: { is_checked: !item.is_checked } })} style={[styles.checkbox, item.is_checked && styles.checkboxChecked]}>
                {item.is_checked ? <Ionicons name="checkmark" size={19} color="#fff" /> : null}
              </Pressable>
              <View style={styles.itemBody}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.display_name}`} onPress={() => setExpandedItemId(isExpanded ? null : item.id)} style={styles.itemSummary}>
                  <Text style={[styles.name, item.is_checked && styles.checked]}>{item.display_name}</Text>
                  <Text style={styles.meta}>{formatQuantity(item)} - {item.match_status}</Text>
                  {item.notes ? <Text style={styles.meta}>{item.notes}</Text> : null}
                </Pressable>
                {isExpanded ? (
                  <View style={styles.itemControls}>
                  <Button label="-" icon="remove" onPress={() => patchItem.mutate({ item, patch: { quantity: Math.max(0, (item.quantity ?? 1) - 1) } })} />
                  <Button label="+" icon="add" onPress={() => patchItem.mutate({ item, patch: { quantity: (item.quantity ?? 0) + 1 } })} />
                  {retailerUrl(item) ? (
                    <Button
                      label={item.retailer_display_name ?? data?.retailer_display_name ?? "Walmart"}
                      icon="search"
                      onPress={() => Linking.openURL(retailerUrl(item)!)}
                    />
                  ) : null}
                  <Button label="Delete" icon="trash" variant="danger" onPress={() => deleteItem.mutate(item)} />
                  </View>
                ) : null}
              </View>
            </View>
            );
          })}
        </View>
      )) : null}
      {mode === "list" && !data?.items?.length ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>No grocery items yet</Text>
          <Text style={styles.empty}>Choose meals or add a household item, then regenerate the list.</Text>
          </View>
      ) : null}
    </Screen>
  );
}

function groupItems(items: GroceryItem[]) {
  const groups = new Map<string, GroceryItem[]>();
  for (const item of items) {
    const key = item.category || "uncategorized";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function formatQuantity(item: GroceryItem) {
  if (item.quantity === null) return item.unit ? item.unit : "Quantity needs review";
  return `${item.quantity} ${item.unit ?? ""}`.trim();
}

function retailerUrl(item: GroceryItem) {
  return item.retailer_search_url ?? item.walmart_search_url ?? null;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  title: { fontSize: 32, fontWeight: "900", color: Colors.ink },
  subtitle: { color: Colors.muted },
  status: { color: Colors.basil, fontWeight: "800", marginBottom: 10 },
  panel: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, gap: 10, marginTop: 12, marginBottom: 12 },
  sectionTitle: { color: Colors.ink, fontSize: 18, fontWeight: "900" },
  inputRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  input: { minHeight: 46, flex: 1, minWidth: 130, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, backgroundColor: Colors.surface },
  smallInput: { minWidth: 74, flex: 0.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pantryChip: { flexDirection: "row", gap: 7, alignItems: "center", borderRadius: 999, backgroundColor: Colors.softRed, paddingHorizontal: 10, minHeight: 34 },
  pantryText: { color: Colors.tomatoDark, fontWeight: "800", textTransform: "capitalize" },
  pantryRemove: { color: Colors.tomatoDark, fontWeight: "900", fontSize: 16 },
  group: { marginTop: 12, marginBottom: 2, gap: 8 },
  category: { color: Colors.basil, fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  item: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, flexDirection: "row", gap: 10 },
  itemExpanded: { borderColor: "#f0b6b2" },
  checkbox: { width: 30, height: 30, borderRadius: 8, borderWidth: 2, borderColor: Colors.border, alignItems: "center", justifyContent: "center", marginTop: 2 },
  checkboxChecked: { backgroundColor: Colors.basil, borderColor: Colors.basil },
  itemBody: { flex: 1, gap: 1 },
  itemSummary: { gap: 1 },
  name: { fontSize: 17, fontWeight: "800", color: Colors.ink },
  checked: { textDecorationLine: "line-through", color: Colors.muted },
  meta: { color: Colors.muted, marginTop: 2 },
  itemControls: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  emptyPanel: { alignItems: "center", paddingVertical: 36, gap: 6 },
  emptyTitle: { color: Colors.ink, fontWeight: "900", fontSize: 20 },
  empty: { color: Colors.muted, textAlign: "center" }
});
