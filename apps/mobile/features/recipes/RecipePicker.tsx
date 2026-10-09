import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { SearchField } from "@/components/SearchField";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";
import { RecipePhoto } from "./RecipePhoto";

export function RecipePicker({ title, visible, busy, error, ownedOnly = false, weeklyChoices = false, householdId, onClose, onSelect }: {
  title: string; visible: boolean; busy: boolean; error?: string;
  ownedOnly?: boolean;
  weeklyChoices?: boolean;
  householdId?: string;
  onClose: () => void; onSelect: (recipe: Recipe) => void;
}) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"weekly" | "all">("weekly");
  const weekStart = usePlannerStore(state => state.weekStart);
  const weekly = weeklyChoices && tab === "weekly";
  const recipes = useInfiniteQuery({ queryKey: ["recipes", "picker", householdId, ownedOnly, weekly, weekly ? weekStart : null, search.trim()],
    queryFn: async ({ pageParam }) => householdId
      ? (await apiFetch<{ items: { recipe: Recipe }[] }>(`/api/v1/households/${householdId}/library?limit=30&offset=${pageParam}&q=${encodeURIComponent(search.trim())}`)).items.map(item => item.recipe)
      : apiFetch<Recipe[]>(`/api/v1/recipes?limit=30&offset=${pageParam}&owned_only=${ownedOnly}&weekly_picks=${weekly}&apply_preferences=false&q=${encodeURIComponent(search.trim())}`),
    initialPageParam: 0, getNextPageParam: (page, pages) => page.length === 30 ? pages.length * 30 : undefined, enabled: visible });
  const matches = recipes.data?.pages.flat() ?? [];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={styles.backdrop}>
        <View style={styles.panel} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close meal picker" disabled={busy} onPress={onClose} style={styles.icon}>
              <Ionicons name="close" size={24} color={Colors.ink} />
            </Pressable>
          </View>
          {weeklyChoices ? <SegmentedControl value={tab} onChange={setTab} accessibilityLabel="Meal collection" options={[
            { label: "This week's picks", value: "weekly" }, { label: "All recipes", value: "all" }
          ]} /> : null}
          <SearchField accessibilityLabel="Search meals" placeholder="Search meals" value={search} onChangeText={setSearch} editable={!busy} />
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
            {recipes.isLoading ? <Text style={styles.meta}>Loading meals...</Text> : null}
            {recipes.isError ? <Button label="Retry" icon="refresh" onPress={() => { void recipes.refetch(); }} /> : null}
            {!recipes.isLoading && !recipes.isError && !matches.length ? <View style={styles.empty}>
              <Text style={styles.meta}>{search ? "No matching meals." : weekly ? "No favorites or planned picks this week yet." : "No recipes yet."}</Text>
              {weekly && !search ? <Button label="All recipes" icon="book-outline" onPress={() => setTab("all")} /> : null}
            </View> : null}
            {matches.map(recipe => (
              <Pressable key={recipe.id} accessibilityRole="button" accessibilityLabel={`Choose ${recipe.name}`} disabled={busy} onPress={() => onSelect(recipe)} style={[styles.row, busy && styles.disabled]}>
                <RecipePhoto photoUrl={recipe.photo_url} accessibilityLabel={`${recipe.name} photo`} style={styles.photo} />
                <View style={styles.copy}><Text style={styles.name}>{recipe.name}</Text><Text style={styles.meta}>{recipe.total_minutes ? `${recipe.total_minutes} min` : "Recipe"}</Text></View>
                <Ionicons name="add-circle-outline" size={24} color={Colors.tomato} />
              </Pressable>
            ))}
            {recipes.hasNextPage ? <Button label={recipes.isFetchingNextPage ? "Loading..." : "More meals"} icon="chevron-down" disabled={recipes.isFetchingNextPage} onPress={() => { void recipes.fetchNextPage(); }} /> : null}
          </ScrollView>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", padding: 20, alignItems: "center", justifyContent: "center" },
  panel: { backgroundColor: Colors.surface, padding: 16, borderRadius: 8, width: "100%", maxWidth: 520, maxHeight: "85%", gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 20, fontWeight: "800", color: Colors.ink, flex: 1 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  search: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, minHeight: 48, color: Colors.ink },
  list: { flexGrow: 0 },
  empty: { gap: 12, paddingVertical: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: Colors.border },
  photo: { width: 48, height: 48, borderRadius: 6 },
  copy: { flex: 1, minWidth: 0 },
  name: { color: Colors.ink, fontWeight: "700", fontSize: 16 },
  meta: { color: Colors.muted, lineHeight: 22 },
  error: { color: Colors.danger },
  disabled: { opacity: 0.5 }
});
