import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text } from "react-native";

import { Colors } from "@/components/theme";

type Props = {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "secondary" | "danger";
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
};

export function Button({ label, icon, variant = "secondary", onPress, accessibilityLabel, disabled = false }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, styles[variant], disabled ? styles.disabled : null]}
    >
      {icon ? <Ionicons name={icon} size={18} color={variant === "secondary" ? Colors.ink : "#fff"} /> : null}
      <Text style={[styles.label, variant !== "secondary" && styles.lightLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8
  },
  primary: { backgroundColor: Colors.tomato },
  secondary: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  danger: { backgroundColor: Colors.danger },
  disabled: { opacity: 0.45 },
  label: { color: Colors.ink, fontWeight: "700", fontSize: 14 },
  lightLabel: { color: "#fff" }
});
