import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { useTransientMessage } from "@/components/useTransientMessage";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { MealCard, MealCardHandle } from "@/features/discover/MealCard";
import { TourTarget } from "@/features/onboarding/TourTarget";
import { useGuidedTour } from "@/features/onboarding/TourContext";
import { RecipeDetailSheet } from "@/features/recipes/RecipeDetailSheet";
import { apiFetch } from "@/services/api";
import { openSettings } from "@/services/settingsMenu";
import { Recipe, WeeklyPlan } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";
import { shuffleRecipes } from "@/features/discover/deck";
import { useCurrentWeek } from "@/features/planner/useCurrentWeek";
import { useSpace } from "@/features/groups/useSpace";
import { SpaceSelector } from "@/features/groups/SpaceSelector";

export default function DiscoverScreen() {
  const space = useSpace();
  return <DiscoverContent key={space.key} />;
}

function DiscoverContent() {
  const space = useSpace();
  const { height, fontScale } = useWindowDimensions();
  const [viewportHeight, setViewportHeight] = useState(height - 64);
  const [selectorHeight, setSelectorHeight] = useState(76);
  const [cardBodyHeight, setCardBodyHeight] = useState(200);
  const [statusHeight, setStatusHeight] = useState(0);
  const cardHeight = viewportHeight - selectorHeight - statusHeight - 42;
  const accessibleLayout = height < 720 || fontScale > 1.2 || cardBodyHeight + 120 > cardHeight;
  const tour = useGuidedTour();
  const scroll = Platform.OS === "web" || accessibleLayout || Boolean(tour?.expanded && tour.step.id === "discover");
  const router = useRouter();
  const params = useLocalSearchParams<{ replace_slot_id?: string; replace_name?: string }>();
  const queryClient = useQueryClient();
  const cardRef = useRef<MealCardHandle>(null);
  const { sessionId, addSwipe, history, shuffleVersion, restartDiscover, removeChoice } = usePlannerStore();
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [status, setStatus] = useTransientMessage();
  const { data, isLoading, isFetching, error, refetch } = useQuery<Recipe[]>({ queryKey: ["recipes", "discover", space.key], queryFn: async () => {
    const all: Recipe[] = [];
    for (let offset = 0; ; offset += 100) {
      const result = space.groupId ? await apiFetch<{ items: { recipe: Recipe }[]; total: number }>(`/api/v1/households/${space.groupId}/library?discover=true&limit=100&offset=${offset}`) : null;
      const page = result ? result.items.map(item => item.recipe) : await apiFetch<Recipe[]>(`/api/v1/recipes?limit=100&offset=${offset}`);
      all.push(...page);
      if (result ? offset + 100 >= result.total : page.length < 100) return all;
    }
  }, enabled: !space.isLoading && !space.isError, refetchInterval: space.groupId ? 30_000 : false, retry: false });
  const plan = useCurrentWeek();
  const replaceSlotId = typeof params.replace_slot_id === "string" ? params.replace_slot_id : "";
  const replaceName = typeof params.replace_name === "string" ? params.replace_name : "this slot";
  const isReplacingSlot = Boolean(replaceSlotId);
  const swipe = useMutation({
    mutationFn: (payload: { recipe_id: string; action: string; session_id: string; request_id: string; household_id?: string }) =>
      apiFetch("/api/v1/recipes/swipes", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["weekly-plan"] });
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      await queryClient.invalidateQueries({ queryKey: ["grocery"] });
      await queryClient.invalidateQueries({ queryKey: ["group-proposals"] });
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
      setStatus(space.groupId && !space.canManage ? "Your proposal withdrawn." : "Planned dinner undone.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["weekly-plan"] }),
        queryClient.invalidateQueries({ queryKey: ["recipes"] }),
        queryClient.invalidateQueries({ queryKey: ["grocery"] })
      ]);
      await queryClient.invalidateQueries({ queryKey: ["group-proposals"] });
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
  const owner = space.group?.owner ?? space.group?.members?.find(member => member.role === "owner");
  const ownerName = owner && "name" in owner ? owner.name : null;

  const headline = useMemo(
    () => (isReplacingSlot ? "Pick replacement" : "Find dinners"),
    [isReplacingSlot]
  );

  useEffect(() => {
    setStatus("");
  }, [replaceSlotId, setStatus]);
  useEffect(() => { if (!status) setStatusHeight(0); }, [status]);

  function act(action: "add" | "skip" | "favorite" | "hide") {
    if (!current) return;
    if (isReplacingSlot && action === "add") {
      replaceSlot.mutate({ slotId: replaceSlotId, recipeId: current.id });
      return;
    }
    const requestId = addSwipe({ recipe: current, action });
    swipe.mutate({ recipe_id: current.id, action, session_id: sessionId, request_id: requestId, ...(space.groupId ? { household_id: space.groupId } : {}) });
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
    <Screen contentWidth={960} scroll={scroll} onViewportLayout={setViewportHeight} header={
      <View style={styles.header}>
        <View style={styles.brand}>
          <BrandLogo size={46} />
          <View style={styles.brandText}>
            <Text style={styles.eyebrow}>{progressText}</Text>
            <Text style={styles.title}>{headline}</Text>
          </View>
        </View>
        {!isReplacingSlot ? (
          <Button
            label=""
            accessibilityLabel="Undo"
            icon="arrow-undo"
            variant="quiet"
            disabled={!canUndoPlannedMeal}
            onPress={() => {
              if (lastAction?.action !== "add" || !lastAction.requestId) return;
              const requestId = lastAction.requestId;
              undoPlannedMeal.mutate(requestId, { onSuccess: () => { removeChoice(requestId); } });
            }}
          />
        ) : null}
      </View>}>
      {status ? <Text style={styles.status} onLayout={event => setStatusHeight(event.nativeEvent.layout.height)}>{status}</Text> : null}
      <TourTarget id="discover" fill>
      {space.isLoading || isLoading || plan.isLoading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={Colors.tomato} />
          <Text style={styles.emptyCopy}>Loading your recipes...</Text>
        </View>
      ) : space.isError || error || plan.isError ? (
        <View style={styles.empty}>
          <Text accessibilityRole="alert" style={styles.done}>Couldn't load your recipes</Text>
          <Text style={styles.emptyCopy}>Check your connection and try again.</Text>
          <Button label={isFetching || plan.isFetching ? "Trying again..." : "Try again"} icon="refresh" disabled={isFetching || plan.isFetching} onPress={() => { if (space.isError) { void space.refetch(); } else { void refetch(); void plan.refetch(); } }} />
        </View>
      ) : recipes.length === 0 && space.groupId ? (
        <View style={styles.empty}>
          <View style={styles.emptyCard} testID="group-discover-empty">
            <BrandLogo size={56} framed />
            <Text style={styles.done}>No recipes selected yet</Text>
            <Text style={styles.emptyCopy}>The group owner hasn't selected any recipes for Discover.</Text>
            {owner ? <View style={styles.owner}><Text style={styles.ownerLabel}>Group owner{ownerName ? `: ${ownerName}` : ""}</Text><Text selectable style={styles.ownerEmail}>{owner.email}</Text></View> : null}
            {space.canManage ? <Button label="Choose recipes" icon="options-outline" onPress={() => openSettings({ tab: "group", groupView: "choices" })} /> : null}
          </View>
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
        <MealCard key={current.id} ref={cardRef} recipe={current} onAction={act} onOpen={() => setSelectedRecipe(current)} compact={Boolean(tour) || accessibleLayout} availableHeight={cardHeight} onBodyLayout={setCardBodyHeight} proposing={Boolean(space.groupId && !space.canManage)} />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.done}>You're caught up</Text>
          <Text style={styles.emptyCopy}>You've seen every recipe in this session.</Text>
          <Button label="Shuffle again" icon="shuffle" onPress={restartDiscover} />
          {!space.groupId ? <Button label="Add a recipe" icon="add" onPress={() => router.push("/recipes?mode=add")} /> : null}
        </View>
      )}
      </TourTarget>
      <View onLayout={event => setSelectorHeight(event.nativeEvent.layout.height)}><SpaceSelector label="Swiping for" /></View>
      <RecipeDetailSheet
        recipe={selectedRecipe}
        visible={!!selectedRecipe}
        onClose={() => setSelectedRecipe(null)}
        onAction={actFromDetails}
        planningAction={space.groupId ? { label: space.canManage ? "Plan for group" : "Propose recipe", busy: swipe.isPending, onPress: () => actFromDetails("add") } : undefined}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 6 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  brandText: { flex: 1, minWidth: 0 },
  eyebrow: { color: Colors.basil, fontWeight: "800", textTransform: "uppercase", fontSize: 12 },
  title: { color: Colors.ink, fontSize: 28, fontWeight: "900" },
  status: { color: Colors.basil, fontWeight: "800", marginBottom: 8 },
  empty: { flexGrow: 1, flexShrink: 0, minHeight: 260, paddingVertical: 20, alignItems: "center", justifyContent: "center", gap: 14 },
  emptyCard: { width: "100%", maxWidth: 440, alignItems: "center", gap: 14, padding: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, borderRadius: 8 },
  owner: { alignItems: "center", gap: 4, width: "100%" },
  ownerLabel: { color: Colors.ink, fontWeight: "700", textAlign: "center", alignSelf: "stretch" },
  ownerEmail: { color: Colors.muted, textAlign: "center", alignSelf: "stretch" },
  emptyCopy: { color: Colors.muted, textAlign: "center", lineHeight: 22, maxWidth: 360 },
  emptyActions: { width: "100%", maxWidth: 320, gap: 10 },
  done: { fontSize: 22, fontWeight: "800", color: Colors.ink, textAlign: "center" },
  link: { color: Colors.blue, fontWeight: "800", fontSize: 16 }
});
