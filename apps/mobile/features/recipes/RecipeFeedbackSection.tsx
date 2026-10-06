import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { Recipe } from "@/services/types";
import { RecipePhoto } from "./RecipePhoto";

export function RecipeFeedbackSection({ ignored, recipes, pending, onOpen, onToggle }: {
  ignored: boolean;
  recipes: Recipe[];
  pending: boolean;
  onOpen: (recipe: Recipe) => void;
  onToggle: (recipe: Recipe) => void;
}) {
  const [expanded, setExpanded] = useState(!ignored);
  const title = ignored ? "Ignored feedback" : "Recipes needing attention";
  return <View style={styles.section}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.heading}>
      <Ionicons name={ignored ? "checkmark-done-outline" : "information-circle-outline"} color={Colors.basil} size={22} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.count}>{recipes.length}</Text>
      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} color={Colors.muted} size={22} />
    </Pressable>
    {expanded ? <>
      {!recipes.length ? <Text style={styles.empty}>{ignored ? "No ignored feedback." : "Nothing needs attention."}</Text> : null}
      {recipes.map(recipe => <View key={recipe.id} style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${recipe.name}`} style={styles.open} onPress={() => onOpen(recipe)}>
          <View style={styles.summary}>
            <RecipePhoto photoUrl={recipe.photo_url} accessibilityLabel={`${recipe.name} photo`} style={styles.photo} />
            <Text style={styles.name}>{recipe.name}</Text>
          </View>
          {(recipe.validation_warnings.length ? recipe.validation_warnings : [recipe.duplicate_status !== "new" ? "Possible duplicate recipe" : "Recipe details need review"]).map((warning, index) => <Text key={index} style={styles.warning}>{warning}</Text>)}
        </Pressable>
        <Button label={ignored ? "Review again" : "Ignore"} accessibilityLabel={`${ignored ? "Review again" : "Ignore feedback for"} ${recipe.name}`} icon={ignored ? "arrow-undo-outline" : "checkmark-done-outline"} disabled={pending} onPress={() => onToggle(recipe)} />
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
  summary: { flexDirection: "row", alignItems: "center", gap: 8 },
  photo: { width: 44, height: 44, borderRadius: 6 },
  name: { flex: 1, color: Colors.ink, fontSize: 17, fontWeight: "800" },
  warning: { color: Colors.muted, lineHeight: 20 },
  empty: { color: Colors.muted, paddingVertical: 12 }
});
