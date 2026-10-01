import { StyleSheet, Text, TextInput, View } from "react-native";
import { Colors } from "@/components/theme";
import { NUTRIENTS, NutritionInputs } from "./recipeNutrition";

export function NutritionFields({ value, onChange }: { value: NutritionInputs; onChange: (value: NutritionInputs) => void }) {
  return <View style={styles.grid}>{NUTRIENTS.map(([key, label]) => <View key={key} style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} keyboardType="decimal-pad" value={value[key]} placeholder="Not entered"
      onChangeText={(text) => onChange({ ...value, [key]: text })} style={styles.input} />
  </View>)}</View>;
}
const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  field: { flexGrow: 1, flexBasis: 120, minWidth: 100, gap: 5 },
  label: { color: Colors.ink, fontWeight: "700" },
  input: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, backgroundColor: Colors.surface, color: Colors.ink }
});
