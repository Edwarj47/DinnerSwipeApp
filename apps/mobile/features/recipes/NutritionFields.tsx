import { StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Colors } from "@/components/theme";
import { NUTRIENTS, NutritionInputs } from "./recipeNutrition";
import { WeightTextInput } from "@/components/WeightUnits";
import { useMeasurementUnits } from "@/services/measurementPreferences";

export function NutritionFields({ value, onChange }: { value: NutritionInputs; onChange: (value: NutritionInputs) => void }) {
  const units = useMeasurementUnits();
  const { fontScale } = useWindowDimensions();
  return <View style={styles.grid}>{NUTRIENTS.map(([key, originalLabel]) => {
    const unit = key === "calories" ? "g" : units[key];
    const label = originalLabel.replace("(g)", `(${unit})`);
    return <View key={key} style={[styles.field, fontScale > 1.3 && { flexBasis: "100%" }]}>
      <Text style={styles.label}>{label}</Text>
      {key === "calories" ? <TextInput accessibilityLabel={label} keyboardType="decimal-pad" value={value[key]} placeholder="Not entered"
        onChangeText={text => onChange({ ...value, [key]: text })} style={styles.input} />
        : <WeightTextInput accessibilityLabel={label} grams={value[key]} onChangeGrams={text => onChange({ ...value, [key]: text })}
          unit={unit} placeholder="Not entered" style={styles.input} />}
    </View>;
  })}</View>;
}
const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  field: { flexGrow: 1, flexBasis: "45%", minWidth: 0, gap: 5 },
  label: { color: Colors.ink, fontWeight: "700" },
  input: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, backgroundColor: Colors.surface, color: Colors.ink }
});
