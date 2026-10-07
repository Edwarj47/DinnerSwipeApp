import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { Recipe } from "@/services/types";
import { RecipePhoto } from "./RecipePhoto";

export type FeedbackAction = "complete" | "ignore" | "review";

export function RecipeFeedbackSection({ section, recipes, pending, selectedIds, onSelect, onOpen, onAction }: {
  section: "review" | "ignored" | "completed";
  recipes: Recipe[];
  pending: boolean;
  selectedIds: string[];
  onSelect: (recipe: Recipe) => void;
  onOpen: (recipe: Recipe) => void;
  onAction: (recipe: Recipe, action: FeedbackAction) => void;
}) {
  const [expanded, setExpanded] = useState(section === "review");
  const title = section === "ignored" ? "Ignored feedback" : section === "completed" ? "Completed reviews" : "Recipes needing attention";
  return <View style={styles.section}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.heading}>
      <Ionicons name={section === "review" ? "information-circle-outline" : "checkmark-done-outline"} color={Colors.basil} size={22} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.count}>{recipes.length}</Text>
      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} color={Colors.muted} size={22} />
    </Pressable>
    {expanded ? <>
      {!recipes.length ? <Text style={styles.empty}>{section === "review" ? "Nothing needs attention." : "No recipes here yet."}</Text> : null}
      {recipes.map(recipe => <View key={recipe.id} style={styles.row}>
        {section === "review" ? <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${recipe.name}`} accessibilityState={{ checked: selectedIds.includes(recipe.id), disabled: pending || (selectedIds.length >= 100 && !selectedIds.includes(recipe.id)) }} disabled={pending || (selectedIds.length >= 100 && !selectedIds.includes(recipe.id))} style={styles.checkbox} onPress={() => onSelect(recipe)}>
          <Ionicons name={selectedIds.includes(recipe.id) ? "checkbox" : "square-outline"} size={24} color={Colors.tomato} />
        </Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${recipe.name}`} style={styles.open} onPress={() => onOpen(recipe)}>
          <View style={styles.summary}>
            <RecipePhoto photoUrl={recipe.photo_url} accessibilityLabel={`${recipe.name} photo`} style={styles.photo} />
            <Text style={styles.name}>{recipe.name}</Text>
          </View>
          {(recipe.validation_warnings.length ? recipe.validation_warnings : [recipe.duplicate_status !== "new" ? "Possible duplicate recipe" : "Recipe details need review"]).map((warning, index) => <Text key={index} style={styles.warning}>{warning}</Text>)}
        </Pressable>
        {section !== "review" ? <Button label="Review again" accessibilityLabel={`Review again ${recipe.name}`} icon="arrow-undo-outline" disabled={pending} onPress={() => onAction(recipe, "review")} /> : null}
      </View>)}
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { borderTopWidth: 1, borderColor: Colors.border, paddingVertical: 8, gap: 8 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  title: { flex: 1, color: Colors.ink, fontSize: 18, fontWeight: "800" },
  count: { color: Colors.muted, fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderColor: Colors.border },
  open: { flex: 1, minWidth: 160, gap: 6 },
  checkbox: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  summary: { flexDirection: "row", alignItems: "center", gap: 8 },
  photo: { width: 44, height: 44, borderRadius: 6 },
  name: { flex: 1, color: Colors.ink, fontSize: 17, fontWeight: "800" },
  warning: { color: Colors.muted, lineHeight: 20 },
  empty: { color: Colors.muted, paddingVertical: 12 }
});
