import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { RESET_DAYS } from "@/services/planningPreferences";

export type ResetDayProps = { value: number; onChange: (value: number) => void; disabled: boolean };

export function ResetDaySelection({ value, onChange, disabled }: ResetDayProps) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 6 }}>
    <Text style={styles.label}>Reset day</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Reset day: ${RESET_DAYS[value]}`}
      accessibilityState={{ expanded: open, disabled }} disabled={disabled}
      style={styles.trigger} onPress={() => setOpen(true)}>
      <Ionicons name="calendar-outline" size={20} color={Colors.muted} />
      <Text style={styles.value}>{RESET_DAYS[value]}</Text>
      <Ionicons name="chevron-down" size={18} color={Colors.muted} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close reset day" onPress={() => setOpen(false)} />
        <View style={styles.menu} accessibilityViewIsModal>
          <View style={styles.header}><Text style={styles.value}>Reset day</Text>
            <Button label="" icon="close" accessibilityLabel="Dismiss reset day" onPress={() => setOpen(false)} /></View>
          <ScrollView>{RESET_DAYS.map((day, index) => <Pressable key={day} accessibilityRole="radio"
            accessibilityLabel={day} accessibilityState={{ checked: index === value }}
            onPress={() => { onChange(index); setOpen(false); }} style={styles.option}>
            <Text style={styles.value}>{day}</Text>
            <Ionicons name={index === value ? "radio-button-on" : "radio-button-off"} size={22} color={Colors.tomato} />
          </Pressable>)}</ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  label: { color: Colors.muted, fontSize: 13, fontWeight: "700" },
  trigger: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 8, backgroundColor: Colors.surface, flexDirection: "row", alignItems: "center", gap: 10 },
  value: { flex: 1, color: Colors.ink, fontSize: 16, fontWeight: "700", minWidth: 0 },
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.4)" },
  menu: { width: "100%", maxWidth: 420, maxHeight: "90%", backgroundColor: Colors.surface, borderRadius: 8, padding: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  option: { minHeight: 48, flexDirection: "row", alignItems: "center", padding: 12, gap: 12 }
});
