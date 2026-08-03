import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { BrandLogo } from "@/components/BrandLogo";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { ImportPanel } from "@/features/imports/ImportPanel";
import { UrlIngestionPanel } from "@/features/ingestion/UrlIngestionPanel";
import { ManualRecipePanel } from "@/features/recipes/ManualRecipePanel";
import { RecipeDetailSheet } from "@/features/recipes/RecipeDetailSheet";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";

type Mode = "web" | "manual" | "file";

export default function RecipesScreen() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("web");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const { data } = useQuery({
    queryKey: ["recipes", q],
    queryFn: () => apiFetch<Recipe[]>(`/api/v1/recipes?q=${encodeURIComponent(q)}`)
  });

  return (
    <Screen>
      <View style={styles.hero}>
        <BrandLogo size={70} framed />
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Dinner Swipe</Text>
          <Text style={styles.title}>Add meals people will vote for.</Text>
        </View>
      </View>
      <View style={styles.segment}>
        {(["web", "manual", "file"] as const).map((item) => (
          <Pressable key={item} accessibilityRole="button" onPress={() => setMode(item)} style={[styles.segmentButton, mode === item && styles.segmentActive]}>
            <Text style={[styles.segmentText, mode === item && styles.segmentTextActive]}>{item === "web" ? "Web" : item === "manual" ? "Manual" : "CSV"}</Text>
          </Pressable>
        ))}
      </View>
      {mode === "web" ? <UrlIngestionPanel /> : null}
      {mode === "manual" ? <ManualRecipePanel /> : null}
      {mode === "file" ? <ImportPanel /> : null}
      <TextInput accessibilityLabel="Search recipes" value={q} onChangeText={setQ} placeholder="Search saved recipes" style={styles.search} />
      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>Recipe library</Text>
        <Text style={styles.count}>{data?.length ?? 0}</Text>
      </View>
      {(data ?? []).map((recipe) => (
        <Pressable key={recipe.id} accessibilityRole="button" accessibilityLabel={`Open ${recipe.name}`} onPress={() => setSelectedRecipe(recipe)} style={styles.row}>
          <Image source={{ uri: recipe.photo_url ?? undefined }} style={styles.thumb} contentFit="cover" />
          <View style={styles.body}>
            <Text style={styles.name}>{recipe.name}</Text>
            <Text style={styles.meta}>{recipe.total_minutes ?? "?"} min • {recipe.difficulty} • {recipe.meal_type}</Text>
            {recipe.validation_warnings.length ? <Text style={styles.warning}>{recipe.validation_warnings[0]}</Text> : null}
          </View>
        </Pressable>
      ))}
      <RecipeDetailSheet recipe={selectedRecipe} visible={!!selectedRecipe} onClose={() => setSelectedRecipe(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: Colors.tomato, borderRadius: 8, padding: 16, flexDirection: "row", gap: 14, alignItems: "center", marginBottom: 14 },
  kicker: { color: "#ffe3e0", fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  title: { color: Colors.surface, fontSize: 25, fontWeight: "900", lineHeight: 30 },
  segment: { flexDirection: "row", backgroundColor: Colors.softRed, borderRadius: 8, padding: 4, marginBottom: 12 },
  segmentButton: { flex: 1, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 7 },
  segmentActive: { backgroundColor: Colors.surface },
  segmentText: { color: Colors.muted, fontWeight: "900" },
  segmentTextActive: { color: Colors.tomato },
  search: { minHeight: 48, backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, paddingHorizontal: 12, marginVertical: 14 },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sectionTitle: { fontSize: 20, fontWeight: "900", color: Colors.ink },
  count: { color: Colors.tomato, fontWeight: "900" },
  row: { flexDirection: "row", gap: 12, padding: 10, backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, marginBottom: 10 },
  thumb: { width: 76, height: 76, borderRadius: 8, backgroundColor: Colors.border },
  body: { flex: 1, justifyContent: "center" },
  name: { fontSize: 17, fontWeight: "900", color: Colors.ink },
  meta: { color: Colors.muted, marginTop: 3 },
  warning: { color: Colors.danger, marginTop: 4 }
});
