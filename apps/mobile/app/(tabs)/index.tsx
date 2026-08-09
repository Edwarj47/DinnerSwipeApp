import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { MealCard } from "@/features/discover/MealCard";
import { OnboardingNextStepCard } from "@/features/onboarding/OnboardingNextStepCard";
import { RecipeDetailSheet } from "@/features/recipes/RecipeDetailSheet";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";

export default function DiscoverScreen() {
  const queryClient = useQueryClient();
  const { sessionId, addSwipe, undo, selectedRecipes } = usePlannerStore();
  const [index, setIndex] = useState(0);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["recipes"], queryFn: () => apiFetch<Recipe[]>("/api/v1/recipes") });
  const swipe = useMutation({
    mutationFn: (payload: { recipe_id: string; action: string; session_id: string }) =>
      apiFetch("/api/v1/recipes/swipes", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["weekly-plan"] })
  });
  const recipes = data ?? [];
  const current = recipes[index];
  const target = 5;
  const complete = selectedRecipes.length >= target;
  const progressText = `${Math.min(selectedRecipes.length, target)} of ${target} dinners`;

  const headline = useMemo(() => (complete ? "Week filled" : "Find dinners"), [complete]);

  function act(action: "add" | "skip" | "favorite" | "hide") {
    if (!current) return;
    addSwipe({ recipe: current, action });
    swipe.mutate({ recipe_id: current.id, action, session_id: sessionId });
    setIndex((value) => value + 1);
  }

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <BrandLogo size={46} />
          <View>
            <Text style={styles.eyebrow}>{progressText}</Text>
            <Text style={styles.title}>{headline}</Text>
          </View>
        </View>
        <Button label="Undo" icon="arrow-undo" onPress={() => {
          const restored = undo();
          if (restored) setIndex((value) => Math.max(0, value - 1));
        }} />
      </View>
      <OnboardingNextStepCard />
      {isLoading ? <ActivityIndicator color={Colors.tomato} /> : null}
      {error ? <Text style={styles.error}>Sign in from Profile, then seed and refresh recipes.</Text> : null}
      {complete ? (
        <View style={styles.empty}>
          <Text style={styles.done}>Your dinner slots are filled.</Text>
          <Link href="/week" style={styles.link}>Review this week</Link>
        </View>
      ) : current ? (
        <MealCard recipe={current} onAction={act} onOpen={() => setSelectedRecipe(current)} />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.done}>No more meals in this session.</Text>
          <Button label="Start over" icon="refresh" onPress={() => setIndex(0)} />
        </View>
      )}
      <RecipeDetailSheet recipe={selectedRecipe} visible={!!selectedRecipe} onClose={() => setSelectedRecipe(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  eyebrow: { color: Colors.basil, fontWeight: "800", textTransform: "uppercase", fontSize: 12 },
  title: { color: Colors.ink, fontSize: 32, fontWeight: "900" },
  error: { color: Colors.danger, marginBottom: 12 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  done: { fontSize: 22, fontWeight: "800", color: Colors.ink, textAlign: "center" },
  link: { color: Colors.blue, fontWeight: "800", fontSize: 16 }
});
