import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { MacroDatePicker } from "@/features/premium/MacroDatePicker";

export function shiftDate(value: string, days: number) {
  const day = new Date(`${value}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}
export function monday(value: string) {
  const day = new Date(`${value}T12:00:00Z`);
  return shiftDate(value, -((day.getUTCDay() + 6) % 7));
}
export function WeekNavigator({ week, currentWeek, onChange }: { week: string; currentWeek: string; onChange: (week: string) => void }) {
  const display = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return <View style={styles.row}>
    <Button label="" icon="chevron-back" variant="quiet" accessibilityLabel="Previous week" onPress={() => onChange(shiftDate(week, -7))} />
    <Text style={styles.range}>{display(week)} - {display(shiftDate(week, 6))}</Text>
    <MacroDatePicker value={week} label="Choose week" title="Choose week" todayLabel="This week" maxDate={shiftDate(currentWeek, 6)} onChange={value => onChange(monday(value))} />
    <Button label="" icon="chevron-forward" variant="quiet" accessibilityLabel="Next week" disabled={week >= currentWeek} onPress={() => onChange(shiftDate(week, 7))} />
  </View>;
}
const styles = StyleSheet.create({ row: { flexDirection: "row", alignItems: "center", gap: 4, marginVertical: 6, minHeight: 44 },
  range: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: "700", color: Colors.ink, textAlign: "center" } });
