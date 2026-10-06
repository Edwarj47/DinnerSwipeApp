import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Colors } from "@/components/theme";

type Props = {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "secondary" | "danger" | "quiet" | "quiet-danger";
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
};

export function Button({ label, icon, variant = "secondary", onPress, accessibilityLabel, disabled = false }: Props) {
  const ref = useRef<View>(null);
  useEffect(() => {
    // RN Web filters title props, so attach the browser tooltip to the DOM node.
    if (Platform.OS === "web") (ref.current as unknown as HTMLElement | null)?.setAttribute("title", accessibilityLabel ?? label);
  }, [accessibilityLabel, label]);
  const color = variant === "primary" || variant === "danger" ? "#fff" : variant === "quiet-danger" ? Colors.danger : Colors.ink;
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, styles[variant], icon && !label ? styles.iconOnly : null, disabled ? styles.disabled : null]}
    >
      {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      {label ? <Text style={[styles.label, { color }]}>{label}</Text> : null}
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
  iconOnly: { width: 44, height: 44, paddingHorizontal: 0, flexShrink: 0 },
  secondary: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  danger: { backgroundColor: Colors.danger },
  quiet: { backgroundColor: "transparent" },
  "quiet-danger": { backgroundColor: "transparent" },
  disabled: { opacity: 0.45 },
  label: { color: Colors.ink, fontWeight: "700", fontSize: 14 }
});
