import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { useTransientMessage } from "@/components/useTransientMessage";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";
import { normalizeRecipeCategory, recipeCategoryOptions } from "@/services/mealCategories";
import { MacroChoice } from "@/features/premium/MacroChoice";
import { AiRecipeJob } from "./aiRecipeTypes";
import { appendRecipeImage, RecipeImage, RecipePhotoPicker } from "./RecipePhotoPicker";
import { NutritionFields } from "./NutritionFields";
import { RecipePhoto } from "./RecipePhoto";
import { EMPTY_NUTRITION, nutritionInputs, parseNutrition } from "./recipeNutrition";

function splitLines(value: string) {
  return value
    .split(/\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ManualRecipePanel({ initialDraft, initialRecipe, onSaved, onCancel }: {
  initialDraft?: AiRecipeJob;
  initialRecipe?: Recipe;
  onSaved?: (recipe: Recipe) => void;
  onCancel?: () => void;
} = {}) {
  const draft = initialDraft?.draft;
  const queryClient = useQueryClient();
  const initial = initialRecipe ?? draft;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [photoUrl, setPhotoUrl] = useState(initialRecipe?.photo_url ?? "");
  const [mealType, setMealType] = useState(() => normalizeRecipeCategory(initial?.meal_type));
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? "easy");
  const [servings, setServings] = useState(String(initial?.servings ?? 4));
  const [prepMinutes, setPrepMinutes] = useState(initial?.prep_minutes != null ? String(initial.prep_minutes) : "");
  const [cookMinutes, setCookMinutes] = useState(initial?.cook_minutes != null ? String(initial.cook_minutes) : "");
  const [timingEdited, setTimingEdited] = useState(false);
  const [sourceUrl, setSourceUrl] = useState(initialRecipe?.source_url ?? "");
  const [sourceTitle, setSourceTitle] = useState(initialRecipe?.source_title ?? "");
  const [tags, setTags] = useState(initialRecipe?.tags.join(", ") ?? "");
  const [ingredients, setIngredients] = useState(initialRecipe?.ingredients.map(item => item.original_text).join("\n") ?? draft?.ingredients.join("\n") ?? "");
  const [instructions, setInstructions] = useState(initialRecipe?.instructions.map(item => item.text).join("\n") ?? draft?.instructions.join("\n") ?? "");
  const [status, setStatus] = useTransientMessage();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [nutrition, setNutrition] = useState(() => nutritionInputs(initial?.nutrition));
  const [nutritionBasis, setNutritionBasis] = useState<"serving" | "recipe">(draft?.nutrition_basis ?? "serving");
  const ingredientRows = splitLines(ingredients);
  const instructionRows = splitLines(instructions);
  const hasRequiredFields = name.trim().length > 1 && Number.isInteger(Number(servings)) && Number(servings) >= 1 && Number(servings) <= 30;
  const editingOwned = Boolean(initialRecipe?.can_edit);
  const validTiming = [prepMinutes, cookMinutes].every(value => !value.trim() ||
    (Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1440));
  const totalMinutes = prepMinutes.trim() || cookMinutes.trim()
    ? Number(prepMinutes) + Number(cookMinutes)
    : timingEdited ? null : initial?.total_minutes ?? null;

  async function uploadPhoto(image: RecipeImage) {
    setPhotoBusy(true);
    try {
      const form = new FormData();
      appendRecipeImage(form, "file", image);
      const data = await apiFetch<{ photo_url: string }>("/api/v1/recipes/photo-upload", { method: "POST", body: form });
      setPhotoUrl(data.photo_url);
      setStatus("Photo attached.");
    } finally { setPhotoBusy(false); }
  }

  const create = useMutation({
    mutationFn: () => {
      const path = editingOwned ? `/api/v1/recipes/${initialRecipe!.id}` : initialDraft ? `/api/v1/ai-recipes/${initialDraft.id}/approve` : "/api/v1/recipes";
      return apiFetch<Recipe>(path, {
        method: editingOwned ? "PUT" : "POST",
        body: JSON.stringify({
          name,
          description: description || null,
          photo_url: photoUrl || null,
          servings: Number(servings),
          prep_minutes: prepMinutes.trim() ? Number(prepMinutes) : null,
          cook_minutes: cookMinutes.trim() ? Number(cookMinutes) : null,
          total_minutes: totalMinutes,
          difficulty,
          meal_type: mealType,
          cuisine: initialRecipe?.cuisine ?? null,
          source_url: sourceUrl || null,
          source_title: sourceTitle || null,
          tags: listFromText(tags),
          ingredients: ingredientRows.map((original_text, index) => {
            const original = initialRecipe?.ingredients[index];
            return original?.original_text === original_text ? { ...original, sort_order: index } : { original_text, sort_order: index };
          }),
          instructions: instructionRows.map((text, index) => {
            const original = initialRecipe?.instructions[index];
            return original?.text === text ? { ...original, step_number: index + 1 } : { text, step_number: index + 1 };
          }),
          source_type: editingOwned ? initialRecipe!.source_type : "manual",
          ...(!initialRecipe?.calculator_id ? { nutrition: parseNutrition(nutrition, nutritionBasis === "recipe" ? Number(servings) : 1) } : {}),
          ...(!editingOwned && initialRecipe?.calculator_id ? { calculator_source_id: initialRecipe.calculator_id } : {}),
          accept_placeholder_photo: !photoUrl
        })
      });
    },
    onSuccess: async updated => {
      if (initialRecipe) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["recipes"] }),
          queryClient.invalidateQueries({ queryKey: ["weekly-plan"] }),
          queryClient.invalidateQueries({ queryKey: ["grocery"] }),
          queryClient.invalidateQueries({ queryKey: ["vote-options"] })
        ]);
        setStatus(editingOwned ? "Recipe updated." : "Recipe copy saved.");
        onSaved?.(updated);
        return;
      }
      setName("");
      setDescription("");
      setPhotoUrl("");
      setMealType("dinner");
      setDifficulty("easy");
      setServings("4");
      setPrepMinutes("");
      setCookMinutes("");
      setTimingEdited(true);
      setTags("");
      setSourceUrl("");
      setSourceTitle("");
      setIngredients("");
      setInstructions("");
      setNutrition(EMPTY_NUTRITION);
      setNutritionBasis("serving");
      setStatus("Recipe saved. It is ready for planning.");
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      onSaved?.(updated);
    },
    onMutate: () => setStatus(""),
    onError: () => setStatus("")
  });
  const canSave = hasRequiredFields && validTiming && (totalMinutes ?? 0) <= 1440 && !create.isPending && !photoBusy;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>{initialRecipe ? editingOwned ? "Edit recipe" : "Customize recipe" : initialDraft ? "Review recipe" : "Create recipe"}</Text>
        {!initialRecipe ? <Text style={styles.badge}>{initialDraft ? "AI draft" : "Manual"}</Text> : null}
      </View>
      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput accessibilityLabel="Recipe name" value={name} onChangeText={setName} placeholder="Recipe name" style={styles.input} />
      <Text style={styles.fieldLabel}>Description</Text>
      <TextInput accessibilityLabel="Recipe description" value={description} onChangeText={setDescription} placeholder="Short description" multiline style={[styles.input, styles.area]} />
      <Text style={styles.fieldLabel}>Recipe photo</Text>
      <RecipePhotoPicker onSelect={uploadPhoto} disabled={create.isPending} />
      {photoUrl ? <>
        <RecipePhoto photoUrl={photoUrl} accessibilityLabel="Recipe photo preview" style={styles.preview} contentFit="contain" />
        <Button label="Remove photo" icon="close" disabled={create.isPending || photoBusy} onPress={() => setPhotoUrl("")} />
      </> : null}
      <Text style={styles.fieldLabel}>Meal type</Text>
      <MacroChoice label="Meal type" value={mealType} onChange={setMealType} options={recipeCategoryOptions(mealType)} disabled={create.isPending} />
      <View style={styles.grid}>
        {([
          ["Servings", servings, setServings, true],
          ["Difficulty", difficulty, setDifficulty, false],
          ["Prep minutes", prepMinutes, (value: string) => { setTimingEdited(true); setPrepMinutes(value); }, true],
          ["Cook minutes", cookMinutes, (value: string) => { setTimingEdited(true); setCookMinutes(value); }, true]
        ] as const).map(([label, value, setter, numeric]) => <View key={label} style={styles.gridInput}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput accessibilityLabel={label} value={value} onChangeText={setter} keyboardType={numeric ? "number-pad" : "default"} style={styles.input} />
        </View>)}
      </View>
      <Text style={styles.fieldLabel}>Total minutes</Text>
      <Text accessibilityLabel="Total minutes" style={styles.total}>{validTiming && totalMinutes != null ? String(totalMinutes) : "Not entered"}</Text>
      {!validTiming || (totalMinutes ?? 0) > 1440 ? <Text style={styles.warning}>Use whole minutes, up to 1440 in total.</Text> : null}
      <Text style={styles.fieldLabel}>Tags</Text>
      <TextInput accessibilityLabel="Tags" value={tags} onChangeText={setTags} placeholder="Tags, comma separated" style={styles.input} />
      {initialRecipe ? <>
        <Text style={styles.fieldLabel}>Source link</Text>
        <TextInput accessibilityLabel="Source URL" value={sourceUrl} onChangeText={setSourceUrl} autoCapitalize="none" style={styles.input} />
        <Text style={styles.fieldLabel}>Source title</Text>
        <TextInput accessibilityLabel="Source title" value={sourceTitle} onChangeText={setSourceTitle} style={styles.input} />
      </> : null}
      <Text style={styles.fieldLabel}>Ingredients (optional)</Text>
      <TextInput accessibilityLabel="Ingredients" value={ingredients} onChangeText={setIngredients} placeholder="Ingredients, one per line" multiline style={[styles.input, styles.area]} />
      <Text style={styles.fieldLabel}>Instructions (optional)</Text>
      <TextInput accessibilityLabel="Instructions" value={instructions} onChangeText={setInstructions} placeholder="Instructions, one step per line" multiline style={[styles.input, styles.area]} />
      {!initialRecipe?.calculator_id ? <><Text style={styles.title}>Nutrition (optional)</Text>
      <SegmentedControl accessibilityLabel="Nutrition amounts" value={nutritionBasis} onChange={setNutritionBasis}
        options={[{ label: "Per serving", value: "serving" }, { label: "Whole recipe", value: "recipe" }]} />
      <NutritionFields value={nutrition} onChange={setNutrition} />
      </> : null}
      <View style={styles.summary}>
        <Text style={styles.meta}>{ingredientRows.length} ingredient{ingredientRows.length === 1 ? "" : "s"} • {instructionRows.length} step{instructionRows.length === 1 ? "" : "s"}</Text>
        {!hasRequiredFields ? <Text style={styles.warning}>Enter a name and use 1-30 servings.</Text> : null}
      </View>
      {onCancel ? <Button label="Cancel editing" icon="close" disabled={create.isPending} onPress={onCancel} /> : null}
      <Button label={create.isPending ? "Saving..." : initialRecipe && !editingOwned ? "Save a copy" : "Save recipe"} icon="save" variant="primary" disabled={!canSave} onPress={() => create.mutate()} />
      {create.error ? <Text accessibilityRole="alert" style={styles.warning}>{create.error instanceof Error ? create.error.message : "Unable to save recipe."}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

function listFromText(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

const styles = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 12, gap: 8, marginBottom: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 19, fontWeight: "900", color: Colors.ink, flexShrink: 1 },
  badge: { color: Colors.tomato, fontWeight: "900" },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, backgroundColor: Colors.surface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridInput: { minWidth: 110, flexBasis: 124, flexGrow: 1, gap: 6 },
  fieldLabel: { color: Colors.ink, fontWeight: "700" },
  total: { color: Colors.ink, fontWeight: "700", paddingVertical: 6 },
  area: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  preview: { width: "100%", height: 220, borderRadius: 8, backgroundColor: Colors.border },
  summary: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 10, gap: 4 },
  meta: { color: Colors.muted, lineHeight: 20 },
  warning: { color: Colors.danger, fontWeight: "700" },
  status: { color: Colors.basil, fontWeight: "800" }
});
