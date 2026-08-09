import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { BrandLogo } from "@/components/BrandLogo";
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
  const [q, setQ] = useState("");
  const [pageMode, setPageMode] = useState<PageMode>("library");
  const [addMode, setAddMode] = useState<AddMode>("web");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const { data } = useQuery<Recipe[]>({
    queryKey: ["recipes", q],
    queryFn: () => apiFetch<Recipe[]>(`/api/v1/recipes?q=${encodeURIComponent(q)}`)
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
        <Pressable key={recipe.id} accessibilityRole="button" accessibilityLabel={`Open ${recipe.name}`} onPress={() => setSelectedRecipe(recipe)} style={styles.row}>
          <Image source={{ uri: recipe.photo_url ?? undefined }} style={styles.thumb} contentFit="cover" />
          <View style={styles.body}>
            <Text style={styles.name}>{recipe.name}</Text>
            <Text style={styles.meta}>{recipe.total_minutes ?? "?"} min • {recipe.difficulty} • {recipe.meal_type}</Text>
            {recipe.validation_warnings.length ? <Text style={styles.warning}>{recipe.validation_warnings[0]}</Text> : null}
          </View>
        </Pressable>
      )) : null}
      <RecipeDetailSheet recipe={selectedRecipe} visible={!!selectedRecipe} onClose={() => setSelectedRecipe(null)} />
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
  emptyPanel: { alignItems: "center", paddingVertical: 34, gap: 6 },
  emptyTitle: { color: Colors.ink, fontWeight: "900", fontSize: 20 },
  empty: { color: Colors.muted, textAlign: "center", lineHeight: 20 }
});
