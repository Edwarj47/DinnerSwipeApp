import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";

export type PantrySelection = {
  itemId?: string;
  name: string;
  normalizedName: string;
  category: string;
  requiredQuantity?: number | null;
  unit?: string | null;
  stockQuantity?: number | null;
  stockUnit?: string | null;
};

export function PantryCoverageEditor({ selection, onClose, onSaved }: {
  selection: PantrySelection; onClose: () => void; onSaved: (mode: string) => void;
}) {
  const client = useQueryClient();
  const [amount, setAmount] = useState(selection.stockQuantity != null ? String(selection.stockQuantity) : "");
  const [unit, setUnit] = useState(selection.stockQuantity != null ? selection.stockUnit ?? "each" : selection.unit ?? "each");
  const save = useMutation({
    mutationFn: (mode: "enough" | "quantity") => apiFetch(selection.itemId ? `/api/v1/grocery-lists/items/${selection.itemId}/pantry` : "/api/v1/grocery-lists/pantry", {
      method: "POST", body: JSON.stringify({ normalized_name: selection.normalizedName, category: selection.category, coverage_mode: mode, quantity: mode === "quantity" ? Number(amount) : null, unit: mode === "quantity" ? unit.trim() || null : null })
    }),
    onSuccess: async (_, mode) => {
      await Promise.all([client.invalidateQueries({ queryKey: ["grocery"] }), client.invalidateQueries({ queryKey: ["pantry"] })]);
      onSaved(mode);
    }
  });
  const validAmount = amount.trim() !== "" && Number.isFinite(Number(amount)) && Number(amount) >= 0 && Number(amount) <= 999999;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close pantry editor" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View accessibilityViewIsModal style={styles.panel}>
        <Text style={styles.heading}>In Pantry</Text>
        <Text style={styles.name}>{selection.name}</Text>
        {selection.requiredQuantity != null ? <Text style={styles.meta}>Needed this week: {selection.requiredQuantity} {selection.unit ?? "each"}</Text> : null}
        <Button label="Have enough for this week" icon="checkmark-done-outline" variant="primary" disabled={save.isPending} onPress={() => save.mutate("enough")} />
        <View style={styles.amountSection}>
          <Text style={styles.label}>Amount available</Text>
          <View style={styles.fields}>
            <TextInput accessibilityLabel="On-hand quantity" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Quantity" style={[styles.input, { flex: 1 }]} />
            <TextInput accessibilityLabel="Pantry unit" value={unit} onChangeText={setUnit} placeholder="Unit" style={[styles.input, { flex: 1 }]} />
          </View>
          <Button label="Save amount" icon="save-outline" disabled={save.isPending || !validAmount} onPress={() => save.mutate("quantity")} />
        </View>
        {save.isError ? <Text accessibilityRole="alert" style={styles.error}>{save.error.message}</Text> : null}
        <Button label="Cancel" icon="close" onPress={onClose} />
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, padding: 18, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  panel: { width: "100%", maxWidth: 420, backgroundColor: Colors.surface, borderRadius: 8, padding: 16, gap: 12 },
  heading: { fontSize: 20, color: Colors.ink, fontWeight: "900" },
  name: { fontSize: 17, color: Colors.ink, fontWeight: "800" },
  meta: { color: Colors.muted },
  label: { fontWeight: "800", color: Colors.ink },
  amountSection: { borderTopWidth: 1, borderColor: Colors.border, paddingTop: 12, gap: 10 },
  fields: { flexDirection: "row", gap: 8 },
  input: { minWidth: 0, minHeight: 46, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, color: Colors.ink },
  error: { color: Colors.danger }
});
