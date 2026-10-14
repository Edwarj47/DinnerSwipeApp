import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StyleSheet, Switch, Text, View } from "react-native";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { UserProfile } from "@/services/types";

export const DISCOVER_CATEGORIES = [
  { value: "breakfast", label: "Breakfast" }, { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" }, { value: "snack", label: "Snacks" },
  { value: "beverage", label: "Beverages" }, { value: "dessert", label: "Desserts" },
  { value: "sauce", label: "Sauces" }, { value: "other", label: "Other" }
] as const;

export function discoverCategories(profile?: UserProfile): string[] {
  return profile?.discover_preferences?.categories ?? DISCOVER_CATEGORIES.map(item => item.value);
}

export function matchesDiscoverCategories(mealType: string | null | undefined, categories: string[]) {
  const raw = mealType?.trim().toLowerCase() || "dinner";
  const aliases: Record<string, string> = { beverages: "beverage", drink: "beverage", drinks: "beverage",
    snacks: "snack", desserts: "dessert", sauces: "sauce" };
  const category = aliases[raw] ?? raw;
  return categories.includes(DISCOVER_CATEGORIES.some(item => item.value === category) ? category : "other");
}

export function DiscoverSettings() {
  const client = useQueryClient();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/api/v1/profile") });
  const categories = discoverCategories(profile.data);
  const save = useMutation({
    mutationFn: (categories: string[]) => apiFetch<UserProfile>("/api/v1/profile/discover", { method: "PATCH", body: JSON.stringify({ categories }) }),
    onSuccess: async result => {
      client.setQueryData(["profile"], result);
      await client.invalidateQueries({ queryKey: ["recipes", "discover"] });
    }
  });
  return <View style={{ gap: 8 }}>
    {DISCOVER_CATEGORIES.map(item => <View key={item.value} style={styles.row}>
      <Text style={styles.label}>{item.label}</Text>
      <Switch accessibilityLabel={`Discover ${item.label}`} disabled={profile.isLoading || profile.isError || save.isPending}
        value={categories.includes(item.value)} trackColor={{ true: Colors.basil, false: Colors.border }}
        onValueChange={enabled => save.mutate(DISCOVER_CATEGORIES.filter(choice => choice.value === item.value ? enabled : categories.includes(choice.value)).map(choice => choice.value))} />
    </View>)}
    {save.error || profile.error ? <Text accessibilityRole="alert" style={{ color: Colors.danger }}>{(save.error ?? profile.error)?.message}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ row: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  label: { color: Colors.ink, fontSize: 15, flex: 1 } });
