import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { ImportPanel } from "@/features/imports/ImportPanel";
import { UrlIngestionPanel } from "@/features/ingestion/UrlIngestionPanel";
import { ManualRecipePanel } from "@/features/recipes/ManualRecipePanel";
import { RecipeDetailSheet } from "@/features/recipes/RecipeDetailSheet";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";

type PageMode = "library" | "add" | "review";
type AddMode = "web" | "manual" | "file";

export default function RecipesScreen() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [pageMode, setPageMode] = useState<PageMode>("library");
  const [addMode, setAddMode] = useState<AddMode>("web");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [quickActionRecipe, setQuickActionRecipe] = useState<Recipe | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  const { data } = useQuery<Recipe[]>({
    queryKey: ["recipes", q],
    queryFn: () => apiFetch<Recipe[]>(`/api/v1/recipes?q=${encodeURIComponent(q)}`)
  });
  const refreshRecipes = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["recipes"] }),
      queryClient.invalidateQueries({ queryKey: ["weekly-plan"] }),
      queryClient.invalidateQueries({ queryKey: ["grocery"] })
    ]);
  };
  const hideRecipe = useMutation({
    mutationFn: (recipeId: string) =>
      apiFetch("/api/v1/recipes/swipes", {
        method: "POST",
        body: JSON.stringify({
          recipe_id: recipeId,
          action: "hide",
          session_id: "recipe-library"
        })
      }),
    onSuccess: async () => {
      await refreshRecipes();
      setQuickActionRecipe(null);
    },
    onError: (error) => {
      setActionStatus(error instanceof Error ? error.message : "Unable to hide this recipe.");
    }
  });
  const archiveRecipe = useMutation({
    mutationFn: (recipeId: string) =>
      apiFetch(`/api/v1/recipes/${recipeId}/archive`, { method: "POST" }),
    onSuccess: async () => {
      await refreshRecipes();
      setQuickActionRecipe(null);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "";
      setActionStatus(
        message && message !== "Recipe not found"
          ? message
          : "Only recipes you added can be archived. Use Hide from menu for starter meals."
      );
    }
  });
  const recipes: Recipe[] = data ?? [];
  const reviewRecipes = recipes.filter((recipe) =>
    recipe.validation_status !== "approved" ||
    recipe.validation_warnings.length > 0 ||
    recipe.duplicate_status !== "new" ||
    ["requires_review", "missing", "rejected"].includes(recipe.image_status)
  );
  const visibleRecipes = pageMode === "review" ? reviewRecipes : recipes;

  return (
    <Screen>
      <View style={styles.header}>
        <BrandLogo size={54} framed />
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Dinner Swipe</Text>
          <Text style={styles.title}>Recipes</Text>
          <Text style={styles.subtitle}>Save, import, and review meals before they hit Discover.</Text>
        </View>
      </View>
      <SegmentedControl
        accessibilityLabel="Recipe sections"
        value={pageMode}
        onChange={setPageMode}
        options={[
          { label: "Library", value: "library" },
          { label: "Add", value: "add" },
          { label: "Review", value: "review" }
        ]}
      />
      {pageMode === "add" ? (
        <>
          <View style={styles.addSegment}>
            <SegmentedControl
              accessibilityLabel="Recipe add options"
              value={addMode}
              onChange={setAddMode}
              options={[
                { label: "Web", value: "web" },
                { label: "Manual", value: "manual" },
                { label: "CSV", value: "file" }
              ]}
            />
          </View>
          {addMode === "web" ? <UrlIngestionPanel /> : null}
          {addMode === "manual" ? <ManualRecipePanel /> : null}
          {addMode === "file" ? <ImportPanel /> : null}
        </>
      ) : null}
      {pageMode !== "add" ? (
        <>
          <TextInput accessibilityLabel="Search recipes" value={q} onChangeText={setQ} placeholder="Search saved recipes" style={styles.search} />
          <View style={styles.listHeader}>
            <Text style={styles.sectionTitle}>{pageMode === "review" ? "Needs review" : "Recipe library"}</Text>
            <Text style={styles.count}>{visibleRecipes.length}</Text>
          </View>
        </>
      ) : null}
      {pageMode !== "add" && !visibleRecipes.length ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>{pageMode === "review" ? "Nothing needs review" : "No recipes found"}</Text>
          <Text style={styles.empty}>{pageMode === "review" ? "Imported and ingested recipes that need attention will appear here." : "Try another search or add a recipe."}</Text>
        </View>
      ) : null}
      {pageMode !== "add" ? visibleRecipes.map((recipe: Recipe) => (
        <Pressable
          key={recipe.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${recipe.name}`}
          accessibilityHint="Long press for recipe actions"
          delayLongPress={420}
          onLongPress={() => {
            setActionStatus("");
            setQuickActionRecipe(recipe);
          }}
          onPress={() => setSelectedRecipe(recipe)}
          style={[styles.row, quickActionRecipe?.id === recipe.id ? styles.rowSelected : null]}
        >
          <Image source={{ uri: recipe.photo_url ?? undefined }} style={styles.thumb} contentFit="cover" />
          <View style={styles.body}>
            <Text style={styles.name}>{recipe.name}</Text>
            <Text style={styles.meta}>{recipe.total_minutes ?? "?"} min • {recipe.difficulty} • {recipe.meal_type}</Text>
            {recipe.validation_warnings.length ? <Text style={styles.warning}>{recipe.validation_warnings[0]}</Text> : null}
          </View>
        </Pressable>
      )) : null}
      <RecipeDetailSheet recipe={selectedRecipe} visible={!!selectedRecipe} onClose={() => setSelectedRecipe(null)} />
      <Modal
        visible={!!quickActionRecipe}
        transparent
        animationType="fade"
        onRequestClose={() => setQuickActionRecipe(null)}
      >
        <View style={styles.quickBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close recipe actions"
            style={StyleSheet.absoluteFill}
            onPress={() => setQuickActionRecipe(null)}
          />
          <View style={styles.quickPanel}>
            <Text style={styles.quickKicker}>Recipe actions</Text>
            <Text style={styles.quickTitle}>{quickActionRecipe?.name}</Text>
            <Text style={styles.quickCopy}>
              Hide removes starter meals from your menu. Archive removes recipes you created or imported.
            </Text>
            <View style={styles.quickActions}>
              <Button
                label="View details"
                icon="open-outline"
                onPress={() => {
                  setSelectedRecipe(quickActionRecipe);
                  setQuickActionRecipe(null);
                }}
              />
              <Button
                label="Hide from menu"
                icon="eye-off"
                variant="danger"
                disabled={hideRecipe.isPending || archiveRecipe.isPending}
                onPress={() => {
                  if (quickActionRecipe) hideRecipe.mutate(quickActionRecipe.id);
                }}
              />
              <Button
                label="Archive my recipe"
                icon="archive"
                disabled={hideRecipe.isPending || archiveRecipe.isPending}
                onPress={() => {
                  if (quickActionRecipe) archiveRecipe.mutate(quickActionRecipe.id);
                }}
              />
              <Button label="Cancel" icon="close-circle" onPress={() => setQuickActionRecipe(null)} />
            </View>
            {actionStatus ? <Text style={styles.quickStatus}>{actionStatus}</Text> : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: 12, alignItems: "center", marginBottom: 14 },
  kicker: { color: Colors.basil, fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  title: { color: Colors.ink, fontSize: 32, fontWeight: "900", lineHeight: 36 },
  subtitle: { color: Colors.muted, lineHeight: 20 },
  addSegment: { marginTop: 12 },
  search: { minHeight: 48, backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, paddingHorizontal: 12, marginVertical: 14 },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sectionTitle: { fontSize: 20, fontWeight: "900", color: Colors.ink },
  count: { color: Colors.tomato, fontWeight: "900" },
  row: { flexDirection: "row", gap: 12, padding: 10, backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, marginBottom: 10 },
  thumb: { width: 76, height: 76, borderRadius: 8, backgroundColor: Colors.border },
  body: { flex: 1, justifyContent: "center" },
  name: { fontSize: 17, fontWeight: "900", color: Colors.ink },
  meta: { color: Colors.muted, marginTop: 3 },
  warning: { color: Colors.danger, marginTop: 4 },
  rowSelected: { borderColor: Colors.tomato, backgroundColor: Colors.softRed },
  emptyPanel: { alignItems: "center", paddingVertical: 34, gap: 6 },
  emptyTitle: { color: Colors.ink, fontWeight: "900", fontSize: 20 },
  empty: { color: Colors.muted, textAlign: "center", lineHeight: 20 },
  quickBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.32)",
    justifyContent: "flex-end",
    padding: 16
  },
  quickPanel: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderColor: Colors.border,
    borderWidth: 1,
    padding: 16,
    gap: 10
  },
  quickKicker: { color: Colors.basil, fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  quickTitle: { color: Colors.ink, fontWeight: "900", fontSize: 22, lineHeight: 27 },
  quickCopy: { color: Colors.muted, lineHeight: 20 },
  quickActions: { gap: 8 },
  quickStatus: { color: Colors.danger, fontWeight: "700", lineHeight: 20 }
});
