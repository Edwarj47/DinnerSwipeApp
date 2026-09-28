import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { MealCard, MealCardHandle } from "@/features/discover/MealCard";
import { OnboardingNextStepCard } from "@/features/onboarding/OnboardingNextStepCard";
import { RecipeDetailSheet } from "@/features/recipes/RecipeDetailSheet";
import { apiFetch } from "@/services/api";
import { Recipe, WeeklyPlan } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";
import { shuffleRecipes } from "@/features/discover/deck";
import { useCurrentWeek } from "@/features/planner/useCurrentWeek";

export default function DiscoverScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ replace_slot_id?: string; replace_name?: string }>();
  const queryClient = useQueryClient();
  const cardRef = useRef<MealCardHandle>(null);
  const { sessionId, addSwipe, history, shuffleVersion, restartDiscover, removeChoice } = usePlannerStore();
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [status, setStatus] = useState("");
  const { data, isLoading, isFetching, error, refetch } = useQuery<Recipe[]>({ queryKey: ["recipes", "discover"], queryFn: async () => {
    const all: Recipe[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await apiFetch<Recipe[]>(`/api/v1/recipes?limit=100&offset=${offset}`);
      all.push(...page);
      if (page.length < 100) return all;
    }
  }, retry: false });
  const plan = useCurrentWeek();
  const replaceSlotId = typeof params.replace_slot_id === "string" ? params.replace_slot_id : "";
  const replaceName = typeof params.replace_name === "string" ? params.replace_name : "this slot";
  const isReplacingSlot = Boolean(replaceSlotId);
  const swipe = useMutation({
    mutationFn: (payload: { recipe_id: string; action: string; session_id: string; request_id: string }) =>
      apiFetch("/api/v1/recipes/swipes", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["weekly-plan"] });
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      await queryClient.invalidateQueries({ queryKey: ["grocery"] });
    },
    onError: (error, payload) => {
      removeChoice(payload.request_id);
      setStatus(error instanceof Error ? error.message : "Couldn't save this choice. Please try again.");
    }
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
    mutationFn: (requestId: string) => apiFetch(`/api/v1/recipes/swipes/${requestId}/undo`, { method: "POST" }),
    onSuccess: async () => {
      setStatus("Planned dinner undone.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["weekly-plan"] }),
        queryClient.invalidateQueries({ queryKey: ["recipes"] }),
        queryClient.invalidateQueries({ queryKey: ["grocery"] })
      ]);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to undo the planned dinner.")
  });
  const recipes = useMemo(() => shuffleRecipes<Recipe>(data ?? [], `${sessionId}-${shuffleVersion}`), [data, sessionId, shuffleVersion]);
  const plannedIds = new Set(plan.data?.slots.flatMap((slot: WeeklyPlan["slots"][number]) => slot.recipe_id ? [slot.recipe_id] : []) ?? []);
  const seenIds = new Set(history.map(item => item.recipe.id));
  const current = recipes.find(recipe => !recipe.is_hidden && !plannedIds.has(recipe.id) && !seenIds.has(recipe.id));
  const plannedCount = plan.data?.slots.filter((slot: WeeklyPlan["slots"][number]) => slot.slot_type === "meal" && slot.recipe_id).length ?? 0;
  const progressText = isReplacingSlot ? `Replacing ${replaceName}` : `${plannedCount} ${plannedCount === 1 ? "meal" : "meals"} planned`;
  const lastAction = history[history.length - 1];
  const canUndoPlannedMeal = !isReplacingSlot && lastAction?.action === "add" && !!lastAction.requestId && !undoPlannedMeal.isPending && !swipe.isPending;

  const headline = useMemo(
    () => (isReplacingSlot ? "Pick replacement" : "Find dinners"),
    [isReplacingSlot]
  );

  useEffect(() => {
    setStatus("");
  }, [replaceSlotId]);

  function act(action: "add" | "skip" | "favorite" | "hide") {
    if (!current) return;
    if (isReplacingSlot && action === "add") {
      replaceSlot.mutate({ slotId: replaceSlotId, recipeId: current.id });
      return;
    }
    const requestId = addSwipe({ recipe: current, action });
    swipe.mutate({ recipe_id: current.id, action, session_id: sessionId, request_id: requestId });
  }

  function actFromDetails(action: "add" | "skip" | "favorite" | "hide") {
    setSelectedRecipe(null);
    if (cardRef.current) {
      cardRef.current.choose(action);
      return;
    }
    act(action);
  }

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <BrandLogo size={46} />
          <View style={styles.brandText}>
            <Text numberOfLines={1} style={styles.eyebrow}>{progressText}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={styles.title}>{headline}</Text>
          </View>
        </View>
        {!isReplacingSlot ? (
          <Button
            label="Undo"
            icon="arrow-undo"
            disabled={!canUndoPlannedMeal}
            onPress={() => {
              if (lastAction?.action !== "add" || !lastAction.requestId) return;
              const requestId = lastAction.requestId;
              undoPlannedMeal.mutate(requestId, { onSuccess: () => { removeChoice(requestId); } });
            }}
          />
        ) : null}
      </View>
      <OnboardingNextStepCard />
      {status ? <Text style={styles.status}>{status}</Text> : null}
      {isLoading || plan.isLoading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={Colors.tomato} />
          <Text style={styles.emptyCopy}>Loading your recipes...</Text>
        </View>
      ) : error || plan.isError ? (
        <View style={styles.empty}>
          <Text accessibilityRole="alert" style={styles.done}>Couldn't load your recipes</Text>
          <Text style={styles.emptyCopy}>Check your connection and try again.</Text>
          <Button label={isFetching || plan.isFetching ? "Trying again..." : "Try again"} icon="refresh" disabled={isFetching || plan.isFetching} onPress={() => { void refetch(); void plan.refetch(); }} />
        </View>
      ) : recipes.length === 0 ? (
        <View style={styles.empty}>
          <BrandLogo size={72} framed />
          <Text style={styles.done}>Add your first recipe</Text>
          <Text style={styles.emptyCopy}>Start with a dinner you love.</Text>
          <View style={styles.emptyActions}>
            <Button label="Add from a link" icon="link" variant="primary" onPress={() => router.push("/recipes?mode=add&method=web")} />
            <Button label="Enter a recipe" icon="create-outline" onPress={() => router.push("/recipes?mode=add&method=manual")} />
          </View>
        </View>
      ) : current ? (
        <MealCard key={current.id} ref={cardRef} recipe={current} onAction={act} onOpen={() => setSelectedRecipe(current)} />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.done}>You're caught up</Text>
          <Text style={styles.emptyCopy}>You've seen every recipe in this session.</Text>
          <Button label="Shuffle again" icon="shuffle" onPress={restartDiscover} />
          <Button label="Add a recipe" icon="add" onPress={() => router.push("/recipes?mode=add")} />
        </View>
      )}
      <RecipeDetailSheet
        recipe={selectedRecipe}
        visible={!!selectedRecipe}
        onClose={() => setSelectedRecipe(null)}
        onAction={actFromDetails}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 10 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  brandText: { flex: 1, minWidth: 0 },
  eyebrow: { color: Colors.basil, fontWeight: "800", textTransform: "uppercase", fontSize: 12 },
  title: { color: Colors.ink, fontSize: 32, fontWeight: "900" },
  status: { color: Colors.basil, fontWeight: "800", marginBottom: 10 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  emptyCopy: { color: Colors.muted, textAlign: "center", lineHeight: 22, maxWidth: 360 },
  emptyActions: { width: "100%", maxWidth: 320, gap: 10 },
  done: { fontSize: 22, fontWeight: "800", color: Colors.ink, textAlign: "center" },
  link: { color: Colors.blue, fontWeight: "800", fontSize: 16 }
});
