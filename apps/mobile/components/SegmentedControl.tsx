import { Pressable, StyleSheet, Text, View } from "react-native";

import { Colors } from "@/components/theme";

type Option<T extends string> = {
  label: string;
  value: T;
};

type Props<T extends string> = {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  wrap?: boolean;
};

export function SegmentedControl<T extends string>({ value, options, onChange, accessibilityLabel, wrap = false }: Props<T>) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.segment, wrap && styles.wrap]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.button, wrap && styles.wrapButton, active ? styles.active : null]}
          >
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
  button: { flex: 1, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 7, paddingHorizontal: 8 },
  active: { backgroundColor: Colors.surface },
  label: { color: Colors.muted, fontWeight: "900" },
  activeLabel: { color: Colors.tomato }
});
