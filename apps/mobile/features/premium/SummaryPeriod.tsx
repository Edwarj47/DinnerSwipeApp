import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";

export const MAX_SUMMARY_DAYS = 3650;

export function summaryDays(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const days = Number(text);
  return Number.isInteger(days) && days >= 1 && days <= MAX_SUMMARY_DAYS ? days : null;
}

export function SummaryPeriod({ days, onChange, disabled = false, maxDays = MAX_SUMMARY_DAYS }: {
  days: number; onChange: (days: number) => void; disabled?: boolean; maxDays?: number;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(String(days));
  const parsed = summaryDays(input);
  const value = parsed !== null && parsed <= maxDays ? parsed : null;
  const label = days === 1 ? "Today" : `Last ${days} days`;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Summary period: ${label}`} accessibilityState={{ expanded: open, disabled }} disabled={disabled}
      onPress={() => { setInput(String(days)); setOpen(true); }} style={styles.trigger}>
      <Text style={styles.label}>{label}</Text><Ionicons name="chevron-down" size={18} color={Colors.muted} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close summary period" onPress={() => setOpen(false)} />
        <View style={styles.menu} accessibilityViewIsModal>
          <View style={styles.header}><Text style={styles.heading}>Summary period</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss summary period" onPress={() => setOpen(false)} style={styles.close}>
              <Ionicons name="close" size={24} color={Colors.ink} />
            </Pressable>
          </View>
          <Text style={styles.label}>Days</Text>
          <Text style={styles.help}>Choose how many days to show, including today. Enter 1 for today only.</Text>
          <TextInput accessibilityLabel="Summary days" value={input} onChangeText={setInput} keyboardType="number-pad"
            inputMode="numeric" selectTextOnFocus style={styles.input} />
          {value === null ? <Text accessibilityRole="alert" style={styles.error}>Enter a whole number from 1 to {maxDays}.</Text> : null}
          <Button label="Apply" accessibilityLabel="Apply summary period" icon="checkmark" variant="primary" disabled={disabled || value === null}
            onPress={() => { if (value !== null) { if (value !== days) onChange(value); setOpen(false); } }} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  trigger: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, backgroundColor: Colors.surface },
  label: { fontWeight: "700", color: Colors.ink, flexShrink: 1 },
  help: { fontSize: 14, lineHeight: 20, color: Colors.muted },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", padding: 18, alignItems: "center", justifyContent: "center" },
  menu: { width: "100%", maxWidth: 420, padding: 16, borderRadius: 8, backgroundColor: Colors.surface, gap: 12 },
  heading: { fontSize: 20, fontWeight: "800", color: Colors.ink, flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  close: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, minHeight: 48, padding: 12, fontSize: 18, color: Colors.ink },
  error: { color: Colors.danger }
});
