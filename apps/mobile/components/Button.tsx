import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Platform, Pressable, StyleSheet, Text, ViewInstance } from "react-native";

import { useThemeColors, useThemedStyles, ThemeColors } from "@/components/theme";

type Props = {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "secondary" | "danger" | "quiet" | "quiet-danger";
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  compact?: boolean;
};

export function Button({ label, icon, variant = "secondary", onPress, accessibilityLabel, disabled = false, compact = false }: Props) {
  const Colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const ref = useRef<ViewInstance>(null);
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
      style={[styles.button, styles[variant], compact ? styles.compact : null, icon && !label ? styles.iconOnly : null, disabled ? styles.disabled : null]}
    >
      {icon ? <Ionicons name={icon} size={compact ? 16 : 18} color={color} /> : null}
      {label ? <Text style={[styles.label, compact ? styles.compactLabel : null, { color }]}>{label}</Text> : null}
    </Pressable>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  button: {
    minHeight: 44,
    maxWidth: "100%",
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8
  },
  primary: { backgroundColor: Colors.accent },
  iconOnly: { width: 44, height: 44, paddingHorizontal: 0, flexShrink: 0 },
  secondary: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  danger: { backgroundColor: Colors.danger },
  quiet: { backgroundColor: "transparent" },
  "quiet-danger": { backgroundColor: "transparent" },
  disabled: { opacity: 0.45 },
  compact: { paddingHorizontal: 4, gap: 4 },
  compactLabel: { fontSize: 12 },
  label: { color: Colors.ink, fontWeight: "700", fontSize: 14, flexShrink: 1, textAlign: "center", paddingVertical: 8 }
});
