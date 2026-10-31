import { View } from "react-native";
import { WorkoutCheckbox } from "./PerformanceForm";
import { WorkoutCategory } from "./types";
import { categories, useStyles } from "./ui";

export function CategoryFilters({ selected, onChange }: { selected: WorkoutCategory[]; onChange: (categories: WorkoutCategory[]) => void }) {
  const styles = useStyles();
  return <View style={styles.row} accessibilityLabel="Workout categories">{categories.map(category => <View key={category.value} style={{ flexBasis: 130, flexGrow: 1 }}><WorkoutCheckbox label={category.label} checked={selected.includes(category.value)} onChange={() => onChange(selected.includes(category.value) ? selected.filter(value => value !== category.value) : [...selected, category.value])} /></View>)}</View>;
}
