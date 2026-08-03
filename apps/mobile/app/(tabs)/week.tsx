import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { WeeklyPlan } from "@/services/types";

export default function WeekScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["weekly-plan"], queryFn: () => apiFetch<WeeklyPlan>("/api/v1/weekly-plans/current") });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/weekly-plans/current/slots/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["weekly-plan"] })
  });
  return (
    <Screen>
      <Text style={styles.title}>This Week</Text>
      <Text style={styles.subtitle}>{isLoading ? "Loading plan..." : `${data?.slots.length ?? 0} dinner slots`}</Text>
      <View style={styles.list}>
        {data?.slots.map((slot, index) => (
          <View key={slot.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.day}>Dinner {index + 1}</Text>
              <Text style={styles.meal}>{slot.recipe_name ?? slot.slot_type.replace("_", " ")}</Text>
              <Text style={styles.meta}>Serves {slot.servings} • {slot.is_locked ? "locked" : "flexible"}</Text>
            </View>
            {slot.recipe_id ? <Button label="Remove" icon="trash" onPress={() => remove.mutate(slot.id)} /> : null}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: "900", color: Colors.ink },
  subtitle: { color: Colors.muted, marginBottom: 14 },
  list: { gap: 10 },
  row: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, flexDirection: "row", gap: 10 },
  day: { color: Colors.basil, fontWeight: "800", fontSize: 12, textTransform: "uppercase" },
  meal: { color: Colors.ink, fontSize: 18, fontWeight: "800", textTransform: "capitalize" },
  meta: { color: Colors.muted, marginTop: 2 }
});

