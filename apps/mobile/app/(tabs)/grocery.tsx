import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";

type GroceryItem = { id: string; display_name: string; quantity: number | null; unit: string | null; category: string; is_checked: boolean; walmart_search_url?: string; notes?: string | null };

export default function GroceryScreen() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["grocery"], queryFn: () => apiFetch<{ items: GroceryItem[] }>("/api/v1/grocery-lists/current") });
  const regen = useMutation({ mutationFn: () => apiFetch("/api/v1/grocery-lists/current/regenerate", { method: "POST" }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grocery"] }) });
  const toggle = useMutation({
    mutationFn: (item: GroceryItem) => apiFetch(`/api/v1/grocery-lists/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ is_checked: !item.is_checked }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grocery"] })
  });
  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Grocery List</Text>
        <Button label="Regenerate" icon="sync" onPress={() => regen.mutate()} />
      </View>
      {(data?.items ?? []).map((item) => (
        <Pressable key={item.id} accessibilityRole="checkbox" accessibilityState={{ checked: item.is_checked }} onPress={() => toggle.mutate(item)} style={styles.item}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, item.is_checked && styles.checked]}>{item.display_name}</Text>
            <Text style={styles.meta}>{item.quantity ?? ""} {item.unit ?? ""} • {item.category}{item.notes ? ` • ${item.notes}` : ""}</Text>
          </View>
          {item.walmart_search_url ? <Button label="Walmart" icon="search" onPress={() => Linking.openURL(item.walmart_search_url!)} /> : null}
        </Pressable>
      ))}
      {!data?.items?.length ? <Text style={styles.empty}>Choose meals, then regenerate the list.</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  title: { fontSize: 32, fontWeight: "900", color: Colors.ink },
  item: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 14, marginBottom: 10, flexDirection: "row", gap: 10 },
  name: { fontSize: 17, fontWeight: "800", color: Colors.ink },
  checked: { textDecorationLine: "line-through", color: Colors.muted },
  meta: { color: Colors.muted, marginTop: 2 },
  empty: { color: Colors.muted, textAlign: "center", marginTop: 40 }
});

