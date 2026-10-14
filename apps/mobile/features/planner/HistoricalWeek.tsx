import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { SpaceSelector } from "@/features/groups/SpaceSelector";
import { useSpace } from "@/features/groups/useSpace";
import { RecipePhoto } from "@/features/recipes/RecipePhoto";
import { apiFetch } from "@/services/api";
import { WeeklyPlanHistory } from "@/services/types";
import { shiftDate, WeekNavigator } from "./WeekNavigator";

export function HistoricalWeek({ week, currentWeek, onChange }: { week: string; currentWeek: string; onChange: (week: string) => void }) {
  const space = useSpace();
  const query = useQuery({ queryKey: ["weekly-history", space.key, week], queryFn: ({ signal }) => apiFetch<WeeklyPlanHistory>(space.path(`/api/v1/weekly-plans/history?week_start=${week}`), { signal }),
    enabled: !space.isLoading && !space.isError, retry: false });
  const plan = query.data as WeeklyPlanHistory | undefined;
  const days = [...Array.from({ length: 7 }, (_, offset) => shiftDate(week, offset)), ""];
  return <Screen contentWidth={960} header={<View><Text style={styles.title}>Week History</Text><Text style={styles.meta}>Read-only</Text></View>}>
    <SpaceSelector /><WeekNavigator week={week} currentWeek={currentWeek} onChange={onChange} />
    {query.isLoading ? <Text style={styles.meta}>Loading week...</Text> : query.error ? <View><Text accessibilityRole="alert" style={styles.error}>{query.error.message}</Text><Button label="Retry week" icon="refresh" onPress={() => { void query.refetch(); }} /></View> : !(plan?.slots.some(slot => slot.recipe_id)) ? <Text style={styles.meta}>No saved plan for this week.</Text> : days.map(day => {
      const slots = plan?.slots.filter(slot => (slot.slot_date ?? "") === day && slot.recipe_id).sort((a, b) => a.sort_order - b.sort_order) ?? [];
      return <View key={day || "unscheduled"} style={styles.day}>
        <Text style={styles.heading}>{day ? new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "numeric", day: "numeric", timeZone: "UTC" }) : "Unscheduled"}</Text>
        {!slots.length ? <Text style={styles.meta}>No meals planned</Text> : slots.map(slot => <View key={slot.id} style={styles.meal}>
          <RecipePhoto photoUrl={slot.recipe_photo_url} accessibilityLabel={`${slot.recipe_name ?? "Meal"} photo`} style={styles.photo} />
          <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.heading}>{slot.recipe_name ?? "Saved meal"}</Text><Text style={styles.meta}>Serves {slot.servings}{slot.recipe_total_minutes ? ` - ${slot.recipe_total_minutes} min` : ""}</Text></View>
        </View>)}
      </View>;
    })}
  </Screen>;
}
const styles = StyleSheet.create({ title: { fontSize: 28, fontWeight: "900", color: Colors.ink }, heading: { fontSize: 17, fontWeight: "700", color: Colors.ink },
  meta: { color: Colors.muted, fontSize: 14, lineHeight: 21 }, error: { color: Colors.danger }, day: { gap: 8, paddingVertical: 14, borderBottomWidth: 1, borderColor: Colors.border },
  meal: { flexDirection: "row", gap: 12, alignItems: "center", padding: 12, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface }, photo: { width: 48, height: 48, borderRadius: 6 } });
