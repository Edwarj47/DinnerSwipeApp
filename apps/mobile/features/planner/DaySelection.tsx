import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { DaySelectionProps, daySelectionOptions } from "./daySelectionOptions";

export function DaySelection({ days, value, onChange, disabled = false }: DaySelectionProps) {
  const [open, setOpen] = useState(false);
  const options = daySelectionOptions(days);
  const selected = options.find(option => option.value === (value ?? ""));
  return <View style={styles.field}>
    <Text style={styles.label}>Day selection</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Day selection: ${selected?.label ?? "Choose day"}`}
      accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(true)}
      style={[styles.trigger, disabled && styles.disabled]}>
      <Ionicons name="calendar-outline" size={20} color={Colors.muted} />
      <Text style={styles.value}>{selected?.label ?? "Choose day"}</Text>
      <Ionicons name="chevron-down" size={18} color={Colors.muted} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close day selection" onPress={() => setOpen(false)} />
        <View style={styles.menu} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.heading}>Day selection</Text>
            <Button label="" icon="close" accessibilityLabel="Dismiss day selection" onPress={() => setOpen(false)} />
          </View>
          <ScrollView>
            {options.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
              accessibilityState={{ checked: option.value === (value ?? ""), disabled }} disabled={disabled}
              onPress={() => {
                setOpen(false);
                if (option.value !== (value ?? "")) onChange(option.value || null);
              }}
              style={[styles.option, option.value === (value ?? "") && styles.selected]}>
              <Text style={styles.value}>{option.label}</Text>
              <Ionicons name={option.value === (value ?? "") ? "radio-button-on" : "radio-button-off"} size={22} color={option.value === (value ?? "") ? Colors.tomato : Colors.muted} />
            </Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { color: Colors.muted, fontSize: 13, fontWeight: "700" },
  trigger: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.surface },
  value: { color: Colors.ink, fontSize: 16, fontWeight: "700", flex: 1, minWidth: 0 },
  disabled: { opacity: 0.45 },
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.4)" },
  menu: { width: "100%", maxWidth: 420, maxHeight: "90%", backgroundColor: Colors.surface, borderRadius: 8, padding: 12, gap: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  heading: { flex: 1, color: Colors.ink, fontSize: 18, fontWeight: "800" },
  option: { minHeight: 48, padding: 12, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 6 },
  selected: { backgroundColor: Colors.softRed }
});
