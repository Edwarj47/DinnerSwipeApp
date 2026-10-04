import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";
import { RecipePhoto } from "./RecipePhoto";

export function RecipeLibrarySection({ collection, q, onOpen, onActions }: {
  collection: "library" | "hidden" | "archived"; q: string; onOpen: (recipe: Recipe) => void; onActions: (recipe: Recipe) => void;
}) {
  const [expanded, setExpanded] = useState(collection === "library");
  const title = { library: "Recipe Library", hidden: "Hidden Recipes", archived: "Archived Recipes" }[collection];
  const client = useQueryClient();
  const recipes = useInfiniteQuery({
    queryKey: ["recipes", "collection", collection, q], initialPageParam: 0,
    queryFn: ({ pageParam }) => apiFetch<Recipe[]>(`/api/v1/recipes?collection=${collection}&limit=30&offset=${pageParam}&q=${encodeURIComponent(q)}`),
    getNextPageParam: (last, pages) => last.length === 30 ? pages.length * 30 : undefined,
    enabled: expanded
  });
  const restore = useMutation({
    mutationFn: (recipe: Recipe) => apiFetch(`/api/v1/recipes/${recipe.id}/${collection === "archived" ? "restore" : "unhide"}`, { method: "POST" }),
    onSuccess: async (_, recipe) => {
      usePlannerStore.getState().restoreRecipe(recipe.id);
      await client.invalidateQueries({ queryKey: ["recipes"] });
    }
  });
  return <View style={styles.section}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.heading}>
      <Ionicons name={collection === "hidden" ? "eye-off-outline" : collection === "archived" ? "archive-outline" : "book-outline"} size={22} color={Colors.tomato} />
      <Text style={styles.title}>{title}</Text><Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={22} color={Colors.muted} />
    </Pressable>
    {expanded ? <>
      {recipes.isLoading ? <Text style={styles.meta}>Loading recipes...</Text> : null}
      {recipes.isError ? <Button label="Retry recipes" icon="refresh" onPress={() => { void recipes.refetch(); }} /> : null}
      {recipes.data && !recipes.data.pages.flat().length ? <Text style={styles.empty}>{q ? "No matching recipes." : "No recipes here yet."}</Text> : null}
      {recipes.data?.pages.flat().map(recipe => <View key={recipe.id} style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${recipe.name}`} style={styles.open} onPress={() => onOpen(recipe)}
          onLongPress={collection === "library" ? () => onActions(recipe) : undefined} delayLongPress={420}>
          <RecipePhoto photoUrl={recipe.photo_url} accessibilityLabel={`${recipe.name} photo`} style={styles.photo} />
          <View style={styles.body}><Text style={styles.name}>{recipe.name}</Text><Text style={styles.meta}>{recipe.total_minutes ?? "?"} min</Text></View>
        </Pressable>
        {collection === "library" ? <Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${recipe.name}`} style={styles.icon} onPress={() => onActions(recipe)}>
          <Ionicons name="ellipsis-horizontal" size={22} color={Colors.ink} /></Pressable> :
          <Button label={collection === "hidden" ? "Unhide" : "Restore"} accessibilityLabel={`${collection === "hidden" ? "Unhide" : "Restore"} ${recipe.name}`}
            icon={collection === "hidden" ? "eye-outline" : "arrow-undo-outline"} disabled={restore.isPending} onPress={() => restore.mutate(recipe)} />}
      </View>)}
      {recipes.hasNextPage ? <Button label="More recipes" icon="chevron-down" disabled={recipes.isFetchingNextPage} onPress={() => { void recipes.fetchNextPage(); }} /> : null}
      {restore.isError ? <Text accessibilityRole="alert" style={styles.error}>{restore.error instanceof Error ? restore.error.message : "Unable to restore recipe."}</Text> : null}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({
  section: { borderTopWidth: 1, borderColor: Colors.border, paddingVertical: 8, gap: 8 },
  heading: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52 }, title: { flex: 1, color: Colors.ink, fontSize: 20, fontWeight: "800" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderColor: Colors.border },
  open: { flexDirection: "row", flex: 1, minWidth: 170, gap: 10, alignItems: "center" }, body: { flex: 1, minWidth: 0 },
  photo: { width: 54, height: 54, borderRadius: 6, backgroundColor: Colors.border }, name: { color: Colors.ink, fontSize: 16, fontWeight: "700" },
  meta: { color: Colors.muted, marginTop: 4 }, empty: { color: Colors.muted, paddingVertical: 16 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, error: { color: Colors.danger }
});
