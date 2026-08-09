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
};

export function SegmentedControl<T extends string>({ value, options, onChange, accessibilityLabel }: Props<T>) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={styles.segment}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.button, active ? styles.active : null]}
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
  button: { flex: 1, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 7, paddingHorizontal: 8 },
  active: { backgroundColor: Colors.surface },
  label: { color: Colors.muted, fontWeight: "900" },
  activeLabel: { color: Colors.tomato }
});
