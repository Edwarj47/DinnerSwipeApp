import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { AiRecipeJob } from "./aiRecipeTypes";
import { appendRecipeImage, RecipeImage, RecipePhotoPicker } from "./RecipePhotoPicker";

function splitLines(value: string) {
  return value
    .split(/\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ManualRecipePanel({ initialDraft, onSaved }: { initialDraft?: AiRecipeJob; onSaved?: () => void } = {}) {
  const draft = initialDraft?.draft;
  const queryClient = useQueryClient();
  const [name, setName] = useState(draft?.name ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [photoUrl, setPhotoUrl] = useState("");
  const [mealType, setMealType] = useState(draft?.meal_type ?? "dinner");
  const [difficulty, setDifficulty] = useState(draft?.difficulty ?? "easy");
  const [servings, setServings] = useState(String(draft?.servings ?? 4));
  const [prepMinutes, setPrepMinutes] = useState(draft?.prep_minutes != null ? String(draft.prep_minutes) : "");
  const [cookMinutes, setCookMinutes] = useState(draft?.cook_minutes != null ? String(draft.cook_minutes) : "");
  const [totalMinutes, setTotalMinutes] = useState(draft?.total_minutes != null ? String(draft.total_minutes) : "");
  const [tags, setTags] = useState("");
  const [ingredients, setIngredients] = useState(draft?.ingredients.join("\n") ?? "");
  const [instructions, setInstructions] = useState(draft?.instructions.join("\n") ?? "");
  const [status, setStatus] = useState("");
  const ingredientRows = splitLines(ingredients);
  const instructionRows = splitLines(instructions);
  const hasRequiredFields = name.trim().length > 1 && ingredientRows.length > 0 && instructionRows.length > 0;

  async function uploadPhoto(image: RecipeImage) {
    const form = new FormData();
    appendRecipeImage(form, "file", image);
    const data = await apiFetch<{ photo_url: string }>("/api/v1/recipes/photo-upload", { method: "POST", body: form });
    setPhotoUrl(data.photo_url);
    setStatus("Photo attached.");
  }

  const create = useMutation({
    mutationFn: () => {
      return apiFetch(initialDraft ? `/api/v1/ai-recipes/${initialDraft.id}/approve` : "/api/v1/recipes", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: description || null,
          photo_url: photoUrl || null,
          servings: Number(servings) || 4,
          prep_minutes: prepMinutes ? Number(prepMinutes) : null,
          cook_minutes: cookMinutes ? Number(cookMinutes) : null,
          total_minutes: totalMinutes ? Number(totalMinutes) : null,
          difficulty,
          meal_type: mealType,
          tags: listFromText(tags),
          ingredients: ingredientRows.map((original_text, index) => ({ original_text, sort_order: index })),
          instructions: instructionRows.map((text, index) => ({ text, step_number: index + 1 })),
          source_type: "manual",
          accept_placeholder_photo: !photoUrl
        })
      });
    },
    onSuccess: async () => {
      setName("");
      setDescription("");
      setPhotoUrl("");
      setMealType("dinner");
      setDifficulty("easy");
      setServings("4");
      setPrepMinutes("");
      setCookMinutes("");
      setTotalMinutes("");
      setTags("");
      setIngredients("");
      setInstructions("");
      setStatus("Recipe saved. It is ready for planning.");
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      onSaved?.();
    },
    onError: (error) => setStatus(String(error))
  });
  const canSave = hasRequiredFields && !create.isPending;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>{initialDraft ? "Review recipe" : "Create recipe"}</Text>
        <Text style={styles.badge}>{initialDraft ? "AI draft" : "Manual"}</Text>
      </View>
      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput accessibilityLabel="Recipe name" value={name} onChangeText={setName} placeholder="Recipe name" style={styles.input} />
      <Text style={styles.fieldLabel}>Description</Text>
      <TextInput accessibilityLabel="Recipe description" value={description} onChangeText={setDescription} placeholder="Short description" style={styles.input} />
      <Text style={styles.fieldLabel}>Recipe photo</Text>
      <RecipePhotoPicker onSelect={uploadPhoto} disabled={create.isPending} />
      <TextInput accessibilityLabel="Photo URL" value={photoUrl} onChangeText={setPhotoUrl} placeholder="Photo URL or upload result" autoCapitalize="none" style={styles.input} />
      {photoUrl ? <Image source={{ uri: photoUrl }} style={styles.preview} contentFit="contain" /> : null}
      <View style={styles.grid}>
        {([
          ["Servings", servings, setServings, true], ["Meal type", mealType, setMealType, false],
          ["Difficulty", difficulty, setDifficulty, false], ["Prep minutes", prepMinutes, setPrepMinutes, true],
          ["Cook minutes", cookMinutes, setCookMinutes, true], ["Total minutes", totalMinutes, setTotalMinutes, true]
        ] as const).map(([label, value, setter, numeric]) => <View key={label} style={styles.gridInput}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput accessibilityLabel={label} value={value} onChangeText={setter} keyboardType={numeric ? "number-pad" : "default"} style={styles.input} />
        </View>)}
      </View>
      <Text style={styles.fieldLabel}>Tags</Text>
      <TextInput accessibilityLabel="Tags" value={tags} onChangeText={setTags} placeholder="Tags, comma separated" style={styles.input} />
      <Text style={styles.fieldLabel}>Ingredients</Text>
      <TextInput accessibilityLabel="Ingredients" value={ingredients} onChangeText={setIngredients} placeholder="Ingredients, one per line" multiline style={[styles.input, styles.area]} />
      <Text style={styles.fieldLabel}>Instructions</Text>
      <TextInput accessibilityLabel="Instructions" value={instructions} onChangeText={setInstructions} placeholder="Instructions, one step per line" multiline style={[styles.input, styles.area]} />
      <View style={styles.summary}>
        <Text style={styles.meta}>{ingredientRows.length} ingredient{ingredientRows.length === 1 ? "" : "s"} • {instructionRows.length} step{instructionRows.length === 1 ? "" : "s"}</Text>
        {!canSave ? <Text style={styles.warning}>Name, at least one ingredient, and at least one instruction are required.</Text> : null}
      </View>
      <Button label="Save recipe" icon="save" variant="primary" disabled={!canSave} onPress={() => create.mutate()} />
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

function listFromText(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

const styles = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 10, marginBottom: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 19, fontWeight: "900", color: Colors.ink },
  badge: { color: Colors.tomato, fontWeight: "900" },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, backgroundColor: Colors.surface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridInput: { minWidth: 110, flexBasis: 124, flexGrow: 1, gap: 6 },
  fieldLabel: { color: Colors.ink, fontWeight: "700" },
  area: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  preview: { width: "100%", height: 220, borderRadius: 8, backgroundColor: Colors.border },
  summary: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 10, gap: 4 },
  meta: { color: Colors.muted, lineHeight: 20 },
  warning: { color: Colors.danger, fontWeight: "700" },
  status: { color: Colors.basil, fontWeight: "800" }
});
