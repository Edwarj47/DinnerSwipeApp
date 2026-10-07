import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ComponentProps, useState } from "react";

import { Colors } from "@/components/theme";

type Option<T extends string> = {
  label: string;
  value: T;
  accessibilityLabel?: string;
  icon?: ComponentProps<typeof Ionicons>["name"];
};

type Props<T extends string> = {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  wrap?: boolean;
  adaptive?: boolean;
  disabled?: boolean;
};

export function SegmentedControl<T extends string>({ value, options, onChange, accessibilityLabel, wrap = false, adaptive = false, disabled = false }: Props<T>) {
  const { width, fontScale } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const available = (measuredWidth ?? width - 36) - 8;
  const longestWord = Math.max(1, ...options.flatMap(option => option.label.split(/\s+/).map(word => word.length)));
  const minimum = longestWord * 8 * fontScale + 16 + (options.some(option => option.icon) ? 18 : 0);
  const columns = available >= options.length * minimum + (options.length - 1) * 4 ? options.length : available >= minimum * 2 + 4 ? 2 : 1;
  const adaptiveButton: ViewStyle = Platform.OS === "web"
    ? { flexBasis: "auto", flexGrow: 1, flexShrink: 0, minWidth: "max-content" as ViewStyle["minWidth"] }
    : { flexBasis: Math.max(0, (available - (columns - 1) * 4) / columns), flexGrow: 1, flexShrink: 0 };
  return (
    <View accessibilityLabel={accessibilityLabel} onLayout={event => setMeasuredWidth(event.nativeEvent.layout.width)} style={[styles.segment, (wrap || adaptive) && styles.wrap]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected: active, disabled }}
            aria-pressed={active}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[styles.button, wrap && styles.wrapButton, adaptive && adaptiveButton, active ? styles.active : null, disabled && { opacity: 0.5 }]}
          >
            {option.icon ? <Ionicons name={option.icon} size={14} color={Colors.muted} /> : null}
            <Text style={[styles.label, active ? styles.activeLabel : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: "row", backgroundColor: Colors.softRed, borderRadius: 8, padding: 4, gap: 4 },
  wrap: { flexWrap: "wrap" },
  wrapButton: { flexBasis: 124, minWidth: 124, flexGrow: 1 },
  button: { flex: 1, minHeight: 44, flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 8 },
  active: { backgroundColor: Colors.surface },
  label: { color: Colors.muted, fontWeight: "900", flexShrink: 1, textAlign: "center" },
  activeLabel: { color: Colors.tomato }
});
