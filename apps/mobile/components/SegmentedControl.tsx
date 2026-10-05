import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ComponentProps } from "react";

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
  disabled?: boolean;
};

export function SegmentedControl<T extends string>({ value, options, onChange, accessibilityLabel, wrap = false, disabled = false }: Props<T>) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.segment, wrap && styles.wrap]}>
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
            style={[styles.button, wrap && styles.wrapButton, active ? styles.active : null, disabled && { opacity: 0.5 }]}
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
  button: { flex: 1, minHeight: 42, flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center", borderRadius: 7, paddingHorizontal: 8 },
  active: { backgroundColor: Colors.surface },
  label: { color: Colors.muted, fontWeight: "900" },
  activeLabel: { color: Colors.tomato }
});
