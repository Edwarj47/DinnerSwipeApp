import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { WeightTextInput } from "@/components/WeightUnits";
import { convertWeight, formatWeight, weightFactor } from "@/services/weightUnits";
import { useMeasurementUnits } from "@/services/measurementPreferences";

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

export function PantryCoverageEditor({ selection, householdId, onClose, onSaved }: {
  selection: PantrySelection; householdId?: string; onClose: () => void; onSaved: (mode: string) => void;
}) {
  const client = useQueryClient();
  const weightUnit = useMeasurementUnits().ingredient_weight;
  const [amount, setAmount] = useState(selection.stockQuantity != null ? String(selection.stockQuantity) : "");
  const [unit, setUnit] = useState(selection.stockQuantity != null ? selection.stockUnit ?? "each" : selection.unit ?? "each");
  const factor = weightFactor(unit);
  const convertInput = factor !== null;
  const grams = amount.trim() && Number.isFinite(Number(amount)) && factor !== null ? String(Number(amount) * factor) : amount;
  const required = selection.requiredQuantity != null ? convertWeight(selection.requiredQuantity, selection.unit, weightUnit) : null;
  const save = useMutation({
    mutationFn: (mode: "enough" | "quantity") => apiFetch(`${householdId ? `/api/v1/households/${householdId}` : "/api/v1"}/grocery-lists${selection.itemId ? `/items/${selection.itemId}/pantry` : "/pantry"}`, {
      method: "POST", body: JSON.stringify({ normalized_name: selection.normalizedName, category: selection.category, coverage_mode: mode, quantity: mode === "quantity" ? Number(amount) : null, unit: mode === "quantity" ? unit.trim() || null : null })
    }),
    onSuccess: async (_, mode) => {
      await Promise.all([client.invalidateQueries({ queryKey: ["grocery"] }), client.invalidateQueries({ queryKey: ["pantry"] })]);
      onSaved(mode);
    }
  });
  const validAmount = amount.trim() !== "" && Number.isFinite(Number(amount)) && Number(amount) >= 0 && Number(amount) <= 999999;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close pantry editor" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View accessibilityViewIsModal style={styles.panel}>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled" testID="pantry-editor-scroll">
        <Text style={styles.heading}>In Pantry</Text>
        <Text style={styles.name}>{selection.name}</Text>
        {selection.requiredQuantity != null ? <Text style={styles.meta}>Needed this week: {required !== null ? `${formatWeight(required, weightUnit)} ${weightUnit}` : `${selection.requiredQuantity} ${selection.unit ?? "each"}`}</Text> : null}
        <Button label="Have enough for this week" icon="checkmark-done-outline" variant="primary" disabled={save.isPending} onPress={() => save.mutate("enough")} />
        <View style={styles.amountSection}>
          <Text style={styles.label}>Amount available</Text>
          <View style={styles.fields}>
            {convertInput ? <WeightTextInput accessibilityLabel="On-hand quantity" grams={grams} unit={weightUnit}
              onChangeGrams={value => setAmount(value.trim() && Number.isFinite(Number(value)) ? String(Number(value) / factor!) : value)}
              placeholder="Quantity" style={[styles.input, { flex: 1 }]} />
              : <TextInput accessibilityLabel="On-hand quantity" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Quantity" style={[styles.input, { flex: 1 }]} />}
            <TextInput accessibilityLabel="Pantry unit" value={convertInput ? weightUnit : unit} editable={!convertInput} onChangeText={setUnit} placeholder="Unit" style={[styles.input, { flex: 1 }]} />
          </View>
          <Button label="Save amount" icon="save-outline" disabled={save.isPending || !validAmount} onPress={() => save.mutate("quantity")} />
        </View>
        {save.isError ? <Text accessibilityRole="alert" style={styles.error}>{save.error.message}</Text> : null}
        <Button label="Cancel" icon="close" onPress={onClose} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, padding: 18, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  panel: { width: "100%", maxWidth: 420, maxHeight: "100%", backgroundColor: Colors.surface, borderRadius: 8, padding: 16 },
  heading: { fontSize: 20, color: Colors.ink, fontWeight: "900" },
  name: { fontSize: 17, color: Colors.ink, fontWeight: "800" },
  meta: { color: Colors.muted },
  label: { fontWeight: "800", color: Colors.ink },
  amountSection: { borderTopWidth: 1, borderColor: Colors.border, paddingTop: 12, gap: 10 },
  fields: { flexDirection: "row", gap: 8 },
  input: { minWidth: 0, minHeight: 46, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, color: Colors.ink },
  error: { color: Colors.danger }
});
