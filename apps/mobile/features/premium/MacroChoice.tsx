import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/components/theme";

export function MacroChoice<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label}`} accessibilityState={{ expanded: open, disabled }} disabled={disabled}
      onPress={() => setOpen(true)} style={[styles.trigger, disabled && { opacity: 0.6 }]}>
      <Text style={styles.label}>{selected?.label}</Text><Ionicons name="chevron-down" size={18} color={Colors.muted} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={`Close ${label}`} onPress={() => setOpen(false)} />
        <View style={styles.menu} accessibilityViewIsModal>
          <View style={styles.header}><Text style={styles.heading}>{label}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Dismiss ${label}`} onPress={() => setOpen(false)} style={styles.close}>
              <Ionicons name="close" size={24} color={Colors.ink} />
            </Pressable>
          </View>
          <ScrollView>
            {options.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
              accessibilityState={{ checked: option.value === value }} style={styles.option}
              onPress={() => { onChange(option.value); setOpen(false); }}>
              <Text style={styles.label}>{option.label}</Text>
              <Ionicons name={option.value === value ? "radio-button-on" : "radio-button-off"} size={22} color={option.value === value ? Colors.tomato : Colors.muted} />
            </Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  trigger: { flexGrow: 1, minHeight: 44, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, backgroundColor: Colors.surface },
  label: { fontWeight: "700", color: Colors.ink, flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", padding: 18, alignItems: "center", justifyContent: "center" },
  menu: { width: "100%", maxWidth: 420, maxHeight: "80%", padding: 16, borderRadius: 8, backgroundColor: Colors.surface },
  heading: { flex: 1, minWidth: 0, fontSize: 18, fontWeight: "800", color: Colors.ink },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  close: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  option: { minHeight: 52, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: Colors.border }
});
