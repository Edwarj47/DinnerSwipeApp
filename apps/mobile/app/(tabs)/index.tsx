import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
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
import { Recipe, WeeklyPlan } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";

export default function DiscoverScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ replace_slot_id?: string; replace_name?: string }>();
  const queryClient = useQueryClient();
  const { sessionId, addSwipe, undo, selectedRecipes, history } = usePlannerStore();
  const [index, setIndex] = useState(0);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [status, setStatus] = useState("");
  const { data, isLoading, error } = useQuery({ queryKey: ["recipes"], queryFn: () => apiFetch<Recipe[]>("/api/v1/recipes") });
  const replaceSlotId = typeof params.replace_slot_id === "string" ? params.replace_slot_id : "";
  const replaceName = typeof params.replace_name === "string" ? params.replace_name : "this slot";
  const isReplacingSlot = Boolean(replaceSlotId);
  const swipe = useMutation({
    mutationFn: (payload: { recipe_id: string; action: string; session_id: string }) =>
      apiFetch("/api/v1/recipes/swipes", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["weekly-plan"] })
  });
  const replaceSlot = useMutation({
    mutationFn: ({ slotId, recipeId }: { slotId: string; recipeId: string }) =>
      apiFetch(`/api/v1/weekly-plans/current/slots/${slotId}`, {
        method: "PUT",
        body: JSON.stringify({ slot_type: "meal", recipe_id: recipeId })
      }),
    onSuccess: async () => {
      setStatus("Dinner replaced.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["weekly-plan"] }),
        queryClient.invalidateQueries({ queryKey: ["grocery"] })
      ]);
      router.replace("/week");
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to replace this dinner.")
  });
  const undoPlannedMeal = useMutation({
    mutationFn: async (recipeId: string) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const plan = await apiFetch<WeeklyPlan>("/api/v1/weekly-plans/current");
        const slot = [...plan.slots]
          .filter((item) => item.slot_type === "meal" && item.recipe_id === recipeId)
          .sort((a, b) => b.sort_order - a.sort_order)[0];
        if (slot) {
          await apiFetch(`/api/v1/weekly-plans/current/slots/${slot.id}`, { method: "DELETE" });
          return;
        }
        await wait(250);
      }
    },
    onSuccess: async () => {
      setStatus("Planned dinner undone.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["weekly-plan"] }),
        queryClient.invalidateQueries({ queryKey: ["grocery"] })
      ]);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to undo the planned dinner.")
  });
  const recipes = data ?? [];
  const current = recipes[index];
  const target = 5;
  const complete = !isReplacingSlot && selectedRecipes.length >= target;
  const progressText = isReplacingSlot ? `Replacing ${replaceName}` : `${Math.min(selectedRecipes.length, target)} of ${target} dinners`;
  const lastAction = history[history.length - 1];
  const canUndoPlannedMeal = !isReplacingSlot && lastAction?.action === "add" && !undoPlannedMeal.isPending;

  const headline = useMemo(
    () => (isReplacingSlot ? "Pick replacement" : complete ? "Week filled" : "Find dinners"),
    [complete, isReplacingSlot]
  );

  function act(action: "add" | "skip" | "favorite" | "hide") {
    if (!current) return;
    if (isReplacingSlot && action === "add") {
      replaceSlot.mutate({ slotId: replaceSlotId, recipeId: current.id });
      setIndex((value) => value + 1);
      return;
    }
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
        <Button
          label="Undo"
          icon="arrow-undo"
          disabled={!canUndoPlannedMeal}
          onPress={() => {
            const restored = undo();
            if (restored?.action !== "add") return;
            setIndex((value) => Math.max(0, value - 1));
            undoPlannedMeal.mutate(restored.recipe.id);
          }}
        />
      </View>
      <OnboardingNextStepCard />
      {status ? <Text style={styles.status}>{status}</Text> : null}
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
  status: { color: Colors.basil, fontWeight: "800", marginBottom: 10 },
  error: { color: Colors.danger, marginBottom: 12 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  done: { fontSize: 22, fontWeight: "800", color: Colors.ink, textAlign: "center" },
  link: { color: Colors.blue, fontWeight: "800", fontSize: 16 }
});

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
