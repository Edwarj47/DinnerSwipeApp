import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { SearchField } from "@/components/SearchField";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { AiRecipePanel } from "@/features/recipes/AiRecipePanel";
import { UrlIngestionPanel } from "@/features/ingestion/UrlIngestionPanel";
import { UrlRecycleBinPanel } from "@/features/ingestion/UrlRecycleBinPanel";
import { ManualRecipePanel } from "@/features/recipes/ManualRecipePanel";
import { RecipeDetailSheet } from "@/features/recipes/RecipeDetailSheet";
import { RecipeLibrarySection } from "@/features/recipes/RecipeLibrarySection";
import { FeedbackAction, RecipeFeedbackSection } from "@/features/recipes/RecipeFeedbackSection";
import { useTransientMessage } from "@/components/useTransientMessage";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";
import { TourTarget } from "@/features/onboarding/TourTarget";

type PageMode = "library" | "add" | "review";
type AddMode = "web" | "manual" | "ai";

export default function RecipesScreen() {
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ mode?: string; method?: string; tour?: string }>();
  const [q, setQ] = useState("");
  const [pageMode, setPageMode] = useState<PageMode>("library");
  const [addMode, setAddMode] = useState<AddMode>("web");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [quickActionRecipe, setQuickActionRecipe] = useState<Recipe | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useTransientMessage();
  const [selectedFeedbackIds, setSelectedFeedbackIds] = useState<string[]>([]);
  useEffect(() => {
    if (params.mode === "add") {
      setPageMode("add");
      setAddMode(params.method === "manual" || params.method === "ai" ? params.method : "web");
    }
    if (params.mode === "library" || params.mode === "review") setPageMode(params.mode);
  }, [params.mode, params.method, params.tour]);
  const review = useInfiniteQuery({
    queryKey: ["recipes", "review", q],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => apiFetch<Recipe[]>(`/api/v1/recipes?collection=library&limit=100&offset=${pageParam}&q=${encodeURIComponent(q)}`),
    getNextPageParam: (last, pages) => last.length === 100 ? pages.length * 100 : undefined,
    enabled: pageMode === "review"
  });
  const feedback = useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: FeedbackAction }) => {
      if (ids.length === 1 && action !== "complete") {
        return [await apiFetch<Recipe>(`/api/v1/recipes/${ids[0]}/feedback-preference`, { method: "PUT", body: JSON.stringify({ ignored: action === "ignore" }) })];
      }
      return apiFetch<Recipe[]>("/api/v1/recipes/feedback-preferences", { method: "PUT", body: JSON.stringify({ recipe_ids: ids, action }) });
    },
    onMutate: () => setFeedbackStatus(""),
    onSuccess: async (_, { action }) => {
      setSelectedFeedbackIds([]);
      setFeedbackStatus(action === "complete" ? "Review completed." : action === "review" ? "Feedback returned for review." : "Feedback ignored. Recipes stay in your library.");
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
    }
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
  const recipes = review.data?.pages.flat() ?? [];
  const reviewRecipes = recipes.filter((recipe) =>
    recipe.validation_status !== "approved" ||
    recipe.validation_warnings.length > 0 ||
    recipe.duplicate_status !== "new" ||
    ["requires_review", "missing", "rejected"].includes(recipe.image_status)
  );
  const attentionRecipes = reviewRecipes.filter(recipe => !recipe.feedback_ignored && !recipe.feedback_completed);
  const selectedIds = selectedFeedbackIds.filter(id => attentionRecipes.some(recipe => recipe.id === id));
  function toggleFeedbackSelection(recipe: Recipe) {
    setSelectedFeedbackIds(current => current.includes(recipe.id) ? current.filter(id => id !== recipe.id) : current.length < 100 ? [...current, recipe.id] : current);
  }

  return (
    <Screen contentWidth={960} header={
      <View style={styles.header}>
        <BrandLogo size={44} framed />
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Dinner Swipe</Text>
          <Text style={styles.title}>Recipes</Text>
        </View>
      </View>}>
      <TourTarget id="recipe-library"><SegmentedControl
        adaptive
        accessibilityLabel="Recipe sections"
        value={pageMode}
        onChange={setPageMode}
        options={[
          { label: "Library", value: "library" },
          { label: "Add", value: "add" },
          { label: "Needs Work", value: "review" }
        ]}
      /></TourTarget>
      {pageMode === "add" ? (
        <>
          <TourTarget id="recipe-add"><View style={styles.addSegment}>
            <SegmentedControl
              adaptive
              accessibilityLabel="Recipe add options"
              value={addMode}
              onChange={setAddMode}
              options={[
                { label: "Web", value: "web" },
                { label: "Manual", value: "manual" },
                { label: "AI", value: "ai" }
              ]}
            />
          </View></TourTarget>
          {addMode === "web" ? <UrlIngestionPanel /> : null}
          {addMode === "manual" ? <ManualRecipePanel /> : null}
          {addMode === "ai" ? <AiRecipePanel /> : null}
        </>
      ) : null}
      {pageMode === "review" ? <UrlRecycleBinPanel /> : null}
      {pageMode !== "add" ? (
        <>
          <SearchField accessibilityLabel="Search recipes" value={q} onChangeText={value => { setQ(value); setSelectedFeedbackIds([]); }} placeholder="Search saved recipes" />
        </>
      ) : null}
      {pageMode === "library" ? (["library", "hidden", "archived"] as const).map(collection => <RecipeLibrarySection
        key={collection} collection={collection} q={q} onOpen={setSelectedRecipe} onActions={recipe => { setActionStatus(""); setQuickActionRecipe(recipe); }} />) : null}
      {pageMode === "review" ? <>
        {review.isLoading ? <Text style={styles.subtitle}>Loading feedback...</Text> : null}
        {review.isError ? <Button label="Retry feedback" icon="refresh" onPress={() => { void review.refetch(); }} /> : null}
        {feedbackStatus ? <Text style={{ color: Colors.basil, marginBottom: 10 }}>{feedbackStatus}</Text> : null}
        {feedback.isError ? <Text accessibilityRole="alert" style={styles.warning}>{feedback.error.message}</Text> : null}
        {attentionRecipes.length ? <View style={styles.feedbackActions}>
          <Button label={selectedIds.length ? "Clear selection" : attentionRecipes.length > 100 ? "Select first 100" : "Select shown"} icon={selectedIds.length ? "close" : "checkbox-outline"} disabled={feedback.isPending} onPress={() => setSelectedFeedbackIds(selectedIds.length ? [] : attentionRecipes.slice(0, 100).map(recipe => recipe.id))} />
          {selectedIds.length ? <>
            <Button label={`Complete (${selectedIds.length})`} icon="checkmark" variant="primary" disabled={feedback.isPending} onPress={() => feedback.mutate({ ids: selectedIds, action: "complete" })} />
            <Button label="Ignore selected" icon="eye-off-outline" disabled={feedback.isPending} onPress={() => feedback.mutate({ ids: selectedIds, action: "ignore" })} />
          </> : null}
        </View> : null}
        {(["review", "completed", "ignored"] as const).map(section => <RecipeFeedbackSection key={section} section={section}
          recipes={section === "review" ? attentionRecipes : reviewRecipes.filter(recipe => section === "completed" ? recipe.feedback_completed : recipe.feedback_ignored)}
          selectedIds={selectedIds} onSelect={toggleFeedbackSelection} pending={feedback.isPending} onOpen={setSelectedRecipe}
          onAction={(recipe, action) => feedback.mutate({ ids: [recipe.id], action })} />)}
        {review.hasNextPage ? <Button label="More feedback" icon="chevron-down" disabled={review.isFetchingNextPage} onPress={() => { void review.fetchNextPage(); }} /> : null}
      </> : null}
      <RecipeDetailSheet recipe={selectedRecipe} visible={!!selectedRecipe} onClose={() => setSelectedRecipe(null)} onUpdated={setSelectedRecipe} />
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
              {quickActionRecipe?.can_edit ? <Button
                label="Archive my recipe"
                icon="archive"
                disabled={hideRecipe.isPending || archiveRecipe.isPending}
                onPress={() => {
                  if (quickActionRecipe) archiveRecipe.mutate(quickActionRecipe.id);
                }}
              /> : null}
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
  header: { flexDirection: "row", gap: 10, alignItems: "center" },
  kicker: { color: Colors.basil, fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  title: { color: Colors.ink, fontSize: 28, fontWeight: "900", lineHeight: 34 },
  subtitle: { color: Colors.muted, lineHeight: 20 },
  addSegment: { marginTop: 12 },
  search: { minHeight: 48, backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, paddingHorizontal: 12, marginVertical: 12 },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sectionTitle: { fontSize: 18, fontWeight: "900", color: Colors.ink },
  count: { color: Colors.tomato, fontWeight: "900" },
  row: { flexDirection: "row", gap: 12, padding: 12, backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, marginBottom: 8 },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: Colors.border },
  body: { flex: 1, minWidth: 0, justifyContent: "center" },
  name: { fontSize: 17, fontWeight: "900", color: Colors.ink, lineHeight: 22 },
  meta: { color: Colors.muted, marginTop: 2, lineHeight: 20 },
  warning: { color: Colors.danger, marginTop: 4, lineHeight: 20 },
  rowSelected: { borderColor: Colors.tomato, backgroundColor: Colors.softRed },
  emptyPanel: { alignItems: "center", paddingVertical: 24, gap: 8 },
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
  feedbackActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 },
  quickStatus: { color: Colors.danger, fontWeight: "700", lineHeight: 20 }
});
