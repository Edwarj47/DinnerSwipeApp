import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Colors } from "@/components/theme";
import { SubscriptionTier } from "@/services/types";
import { monthlyPrice, PlanPickerProps } from "./planOptions";

export function PlanPicker({ value, onChange, basicPrice, premiumPrice, disabled }: PlanPickerProps) {
  const [open, setOpen] = useState(false);
  const options: { value: SubscriptionTier; label: string; price: number }[] = [
    { value: "basic", label: "Basic", price: basicPrice },
    { value: "premium", label: "Premium", price: premiumPrice }
  ];
  const selected = options.find((option) => option.value === value)!;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Subscription plan: ${selected.label}, ${monthlyPrice(selected.price)}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.trigger, disabled && { opacity: 0.5 }]}
      >
        <Text style={styles.label}>{selected.label} - {monthlyPrice(selected.price)}</Text>
        <Ionicons name="chevron-down" size={20} color={Colors.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} accessibilityLabel="Close plan choices" onPress={() => setOpen(false)}>
          <View style={styles.menu} accessibilityViewIsModal>
            <Text style={styles.heading}>Choose your plan</Text>
            {options.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: value === option.value }}
                onPress={() => { onChange(option.value); setOpen(false); }}
                style={[styles.option, value === option.value && styles.selected]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{option.label}</Text>
                  <Text style={styles.price}>{monthlyPrice(option.price)}</Text>
                </View>
                <Ionicons name={value === option.value ? "radio-button-on" : "radio-button-off"} size={24} color={value === option.value ? Colors.tomato : Colors.muted} />
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { minHeight: 56, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.surface },
  label: { fontSize: 16, fontWeight: "700", color: Colors.ink, flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 24 },
  menu: { width: "100%", maxWidth: 420, borderRadius: 8, padding: 16, gap: 12, backgroundColor: Colors.surface },
  heading: { fontSize: 20, fontWeight: "800", color: Colors.ink },
  option: { flexDirection: "row", alignItems: "center", minHeight: 72, padding: 16, gap: 12, borderRadius: 8 },
  selected: { backgroundColor: Colors.softRed },
  price: { color: Colors.muted, marginTop: 4 }
});
