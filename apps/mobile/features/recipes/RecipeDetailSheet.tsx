import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useMemo, type ReactNode } from "react";
import {
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";

import { Button } from "@/components/Button";
import { Colors, shadow } from "@/components/theme";
import { formatDifficulty, formatMealType, formatSourceType } from "@/features/recipes/recipeDisplay";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";

type RecipeAction = "add" | "skip" | "favorite" | "hide";

type Props = {
  recipe: Recipe | null;
  visible: boolean;
  onClose: () => void;
  onAction?: (action: RecipeAction) => void;
};

export function RecipeDetailSheet({ recipe, visible, onClose, onAction }: Props) {
  const queryClient = useQueryClient();
  const { sessionId, addSwipe } = usePlannerStore();
  const dragToClose = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 72 || gesture.vy > 0.75) {
            onClose();
          }
        }
      }),
    [onClose]
  );
  const actionMutation = useMutation({
    mutationFn: (payload: { recipe_id: string; action: "add" | "favorite" | "hide" }) =>
      apiFetch("/api/v1/recipes/swipes", { method: "POST", body: JSON.stringify({ ...payload, session_id: sessionId }) }),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["weekly-plan"] }),
        queryClient.invalidateQueries({ queryKey: ["recipes"] }),
        queryClient.invalidateQueries({ queryKey: ["grocery"] })
      ]);
      if (variables.action === "hide") {
        onClose();
      }
    }
  });
  const vote = useMutation({
    mutationFn: (payload: { recipe_id: string; vote: "yes" | "maybe" | "no" }) =>
      apiFetch("/api/v1/households/current/votes", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["votes"] })
  });

  if (!recipe) return null;

  function doAction(kind: RecipeAction) {
    if (!recipe) return;
    if (onAction) {
      onAction(kind);
      return;
    }
    if (kind === "skip") {
      onClose();
      return;
    }
    addSwipe({ recipe, action: kind });
    actionMutation.mutate({ recipe_id: recipe.id, action: kind });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View
            {...dragToClose.panHandlers}
            accessibilityRole="button"
            accessibilityLabel="Drag down to close recipe details"
            style={styles.dragHandle}
          >
            <View style={styles.grabber} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close recipe details" onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={24} color={Colors.ink} />
          </Pressable>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Image
              source={{ uri: recipe.photo_url ?? undefined }}
              placeholder={require("../../assets/icon.png")}
              accessibilityLabel={recipe.name}
              style={styles.photo}
              contentFit="cover"
            />
            <View style={styles.titleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.kicker}>{formatMealType(recipe.meal_type)} • {formatSourceType(recipe.source_type)}</Text>
                <Text style={styles.title}>{recipe.name}</Text>
              </View>
              {recipe.is_favorite ? (
                <View style={styles.favoriteBadge}>
                  <Ionicons name="heart" size={14} color="#fff" />
                  <Text style={styles.favoriteText}>Saved</Text>
                </View>
              ) : null}
            </View>
            {recipe.description ? <Text style={styles.description}>{recipe.description}</Text> : null}
            <View style={styles.stats}>
              <Stat label="Total" value={`${recipe.total_minutes ?? "?"} min`} />
              <Stat label="Prep" value={`${recipe.prep_minutes ?? "?"} min`} />
              <Stat label="Serves" value={String(recipe.servings)} />
              <Stat label="Level" value={formatDifficulty(recipe.difficulty)} />
            </View>
            <View style={styles.actionPanel}>
              <Text style={styles.actionTitle}>Choose</Text>
              <View style={styles.actionGrid}>
                <ActionTile
                  title="Plan it"
                  subtitle="add to this week"
                  icon="add-circle"
                  tone="primary"
                  onPress={() => doAction("add")}
                />
                {onAction ? (
                  <ActionTile
                    title="Skip"
                    subtitle="not this session"
                    icon="close-circle"
                    onPress={() => doAction("skip")}
                  />
                ) : null}
                <ActionTile
                  title="Favorite"
                  subtitle="save for later"
                  icon="heart"
                  tone="soft"
                  onPress={() => doAction("favorite")}
                />
                <ActionTile
                  title="Never show"
                  subtitle="hide suggestion"
                  icon="eye-off"
                  tone="danger"
                  onPress={() => doAction("hide")}
                />
              </View>
            </View>
            <View style={styles.votePanel}>
              <Text style={styles.sectionTitle}>Group vote</Text>
              <View style={styles.voteActions}>
                <Button label="Yes" icon="heart" variant="primary" onPress={() => vote.mutate({ recipe_id: recipe.id, vote: "yes" })} />
                <Button label="Maybe" icon="help-circle" onPress={() => vote.mutate({ recipe_id: recipe.id, vote: "maybe" })} />
                <Button label="No" icon="close-circle" onPress={() => vote.mutate({ recipe_id: recipe.id, vote: "no" })} />
              </View>
            </View>
            <RecipeSection title="Ingredients">
              {recipe.ingredients.map((item, index) => (
                <View key={`${item.original_text}-${index}`} style={styles.ingredientRow}>
                  <View style={styles.check} />
                  <Text style={styles.rowText}>{item.original_text}</Text>
                </View>
              ))}
            </RecipeSection>
            <RecipeSection title="Steps">
              {recipe.instructions.map((step) => (
                <View key={`${step.step_number}-${step.text}`} style={styles.stepRow}>
                  <Text style={styles.stepNumber}>{step.step_number}</Text>
                  <Text style={styles.rowText}>{step.text}</Text>
                </View>
              ))}
            </RecipeSection>
            {recipe.tags.length ? (
              <View style={styles.tags}>
                {recipe.tags.map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}
              </View>
            ) : null}
            {recipe.source_url ? (
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(recipe.source_url!)} style={styles.sourceLink}>
                <Ionicons name="open-outline" size={18} color={Colors.blue} />
                <Text style={styles.sourceText}>Open original recipe</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.statValue}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionTile({
  title,
  subtitle,
  icon,
  tone = "default",
  onPress
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: "default" | "primary" | "soft" | "danger";
  onPress: () => void;
}) {
  const isPrimary = tone === "primary" || tone === "danger";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      onPress={onPress}
      style={[
        styles.actionTile,
        tone === "primary" ? styles.actionTilePrimary : null,
        tone === "soft" ? styles.actionTileSoft : null,
        tone === "danger" ? styles.actionTileDanger : null
      ]}
    >
      <Ionicons name={icon} size={19} color={isPrimary ? "#fff" : Colors.ink} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.actionTileTitle, isPrimary ? styles.actionTileTitleLight : null]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.actionTileSubtitle, isPrimary ? styles.actionTileSubtitleLight : null]}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

function RecipeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.32)", justifyContent: "flex-end" },
  sheet: { maxHeight: "92%", backgroundColor: Colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden", ...shadow },
  dragHandle: { minHeight: 28, alignItems: "center", justifyContent: "center" },
  grabber: { width: 42, height: 5, borderRadius: 999, backgroundColor: Colors.border },
  close: { position: "absolute", top: 14, right: 14, zIndex: 2, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 30, gap: 14 },
  photo: { width: "100%", aspectRatio: 1.25, borderRadius: 8, backgroundColor: Colors.border },
  titleRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  kicker: { color: Colors.basil, fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  title: { color: Colors.ink, fontSize: 28, lineHeight: 33, fontWeight: "900" },
  description: { color: Colors.muted, fontSize: 15, lineHeight: 22 },
  favoriteBadge: { flexDirection: "row", gap: 5, alignItems: "center", backgroundColor: Colors.tomato, borderRadius: 999, paddingHorizontal: 10, minHeight: 30 },
  favoriteText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { width: "48%", minHeight: 64, backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, padding: 10, justifyContent: "center" },
  statValue: { color: Colors.ink, fontWeight: "900", fontSize: 17, textTransform: "capitalize" },
  statLabel: { color: Colors.muted, fontWeight: "800", fontSize: 11, textTransform: "uppercase", marginTop: 2 },
  actionPanel: { backgroundColor: Colors.surface, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, padding: 12, gap: 10 },
  actionTitle: { color: Colors.ink, fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionTile: { width: "48%", minHeight: 62, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, backgroundColor: Colors.surface, paddingHorizontal: 11, paddingVertical: 9 },
  actionTilePrimary: { backgroundColor: Colors.tomato, borderColor: Colors.tomato },
  actionTileSoft: { backgroundColor: Colors.softRed, borderColor: "#f0c7c4" },
  actionTileDanger: { backgroundColor: Colors.danger, borderColor: Colors.danger },
  actionTileTitle: { color: Colors.ink, fontWeight: "900", fontSize: 15 },
  actionTileTitleLight: { color: "#fff" },
  actionTileSubtitle: { color: Colors.muted, marginTop: 1, fontSize: 12 },
  actionTileSubtitleLight: { color: "rgba(255,255,255,0.82)" },
  votePanel: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, gap: 10 },
  voteActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  section: { backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, padding: 14, gap: 10 },
  sectionTitle: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  ingredientRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  check: { width: 22, height: 22, borderRadius: 6, borderColor: Colors.border, borderWidth: 2, marginTop: 1 },
  stepRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepNumber: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.tomato, color: "#fff", fontWeight: "900", textAlign: "center", lineHeight: 26 },
  rowText: { color: Colors.ink, fontSize: 16, lineHeight: 23, flex: 1 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, color: Colors.muted, fontWeight: "800" },
  sourceLink: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 44 },
  sourceText: { color: Colors.blue, fontWeight: "900" }
});
