import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { API_URL, apiFetch, getToken } from "@/services/api";
import { Recipe } from "@/services/types";

function splitLines(value: string) {
  return value
    .split(/\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const RANCH_INGREDIENTS = [
  "1/2 cup mayonnaise",
  "1/2 cup sour cream",
  "1/2 cup buttermilk or regular milk",
  "3/4 - 1 teaspoon dried dill weed",
  "1/2 teaspoon dried parsley",
  "1/2 teaspoon dried chives",
  "1/4 teaspoon onion powder",
  "1/2 teaspoon garlic powder",
  "1/4 teaspoon fine sea salt",
  "1/8 teaspoon finely cracked pepper",
  "freshly squeezed lemon juice to taste"
].join("\n");

const STARTERS = [
  {
    label: "Ranch",
    name: "Homemade Ranch",
    mealType: "sauce",
    totalMinutes: "10",
    servings: "8",
    difficulty: "easy",
    ingredients: RANCH_INGREDIENTS,
    instructions: "Whisk all ingredients until smooth.\nChill for at least 30 minutes before serving.\nTaste and adjust lemon juice, salt, and pepper."
  },
  {
    label: "Dinner",
    name: "Quick Chicken Dinner",
    mealType: "dinner",
    totalMinutes: "35",
    servings: "4",
    difficulty: "easy",
    ingredients: "1 lb chicken breast\n1 tablespoon olive oil\n1 teaspoon garlic powder\n1 teaspoon paprika\n1/2 teaspoon salt\n2 cups vegetables",
    instructions: "Season chicken and vegetables.\nCook until chicken reaches a safe internal temperature.\nRest briefly, slice, and serve."
  }
];

export function ManualRecipePanel() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [mealType, setMealType] = useState("dinner");
  const [difficulty, setDifficulty] = useState("easy");
  const [servings, setServings] = useState("4");
  const [prepMinutes, setPrepMinutes] = useState("");
  const [cookMinutes, setCookMinutes] = useState("");
  const [totalMinutes, setTotalMinutes] = useState("");
  const [tags, setTags] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [instructions, setInstructions] = useState("");
  const [status, setStatus] = useState("");
  const ingredientRows = splitLines(ingredients);
  const instructionRows = splitLines(instructions);
  const hasRequiredFields = name.trim().length > 1 && ingredientRows.length > 0 && instructionRows.length > 0;

  async function uploadPhoto(file: File) {
    const token = await getToken();
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API_URL}/api/v1/recipes/photo-upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form
    });
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as { photo_url: string };
    setPhotoUrl(data.photo_url);
    setStatus("Photo uploaded and attached.");
  }

  async function pickNativePhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStatus("Photo permission is required to choose an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const token = await getToken();
    const form = new FormData();
    form.append("file", {
      uri: asset.uri,
      name: asset.fileName ?? "recipe-photo.jpg",
      type: asset.mimeType ?? "image/jpeg"
    } as unknown as Blob);
    const response = await fetch(`${API_URL}/api/v1/recipes/photo-upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form
    });
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as { photo_url: string };
    setPhotoUrl(data.photo_url);
    setStatus("Photo uploaded and attached.");
  }

  const create = useMutation({
    mutationFn: () => {
      return apiFetch<Recipe>("/api/v1/recipes", {
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
    },
    onError: (error) => setStatus(String(error))
  });
  const canSave = hasRequiredFields && !create.isPending;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Create recipe</Text>
        <Text style={styles.badge}>Manual</Text>
      </View>
      <View style={styles.starters}>
        {STARTERS.map((starter) => (
          <Pressable
            key={starter.label}
            accessibilityRole="button"
            onPress={() => {
              setName(starter.name);
              setMealType(starter.mealType);
              setTotalMinutes(starter.totalMinutes);
              setServings(starter.servings);
              setDifficulty(starter.difficulty);
              setIngredients(starter.ingredients);
              setInstructions(starter.instructions);
              setStatus(`${starter.label} starter loaded. Edit anything before saving.`);
            }}
            style={styles.starterChip}
          >
            <Text style={styles.starterText}>{starter.label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput accessibilityLabel="Recipe name" value={name} onChangeText={setName} placeholder="Recipe name" style={styles.input} />
      <TextInput accessibilityLabel="Recipe description" value={description} onChangeText={setDescription} placeholder="Short description" style={styles.input} />
      {Platform.OS === "web" ? (
        React.createElement("input", {
          type: "file",
          accept: "image/jpeg,image/png,image/webp",
          "aria-label": "Upload recipe photo",
          onChange: (event: { target: { files?: FileList } }) => {
            const file = event.target.files?.[0];
            if (file) void uploadPhoto(file).catch((error) => setStatus(String(error)));
          }
        })
      ) : (
        <Button label="Choose photo" icon="image" onPress={() => void pickNativePhoto().catch((error) => setStatus(String(error)))} />
      )}
      <TextInput accessibilityLabel="Photo URL" value={photoUrl} onChangeText={setPhotoUrl} placeholder="Photo URL or upload result" autoCapitalize="none" style={styles.input} />
      {photoUrl ? <Image source={{ uri: photoUrl }} style={styles.preview} contentFit="cover" /> : <View style={styles.emptyPreview}><Text style={styles.emptyPreviewText}>Photo preview</Text></View>}
      <View style={styles.grid}>
        <TextInput accessibilityLabel="Servings" value={servings} onChangeText={setServings} keyboardType="number-pad" placeholder="Servings" style={[styles.input, styles.gridInput]} />
        <TextInput accessibilityLabel="Meal type" value={mealType} onChangeText={setMealType} placeholder="Meal type" style={[styles.input, styles.gridInput]} />
        <TextInput accessibilityLabel="Difficulty" value={difficulty} onChangeText={setDifficulty} placeholder="Difficulty" style={[styles.input, styles.gridInput]} />
        <TextInput accessibilityLabel="Prep minutes" value={prepMinutes} onChangeText={setPrepMinutes} keyboardType="number-pad" placeholder="Prep min" style={[styles.input, styles.gridInput]} />
        <TextInput accessibilityLabel="Cook minutes" value={cookMinutes} onChangeText={setCookMinutes} keyboardType="number-pad" placeholder="Cook min" style={[styles.input, styles.gridInput]} />
        <TextInput accessibilityLabel="Total minutes" value={totalMinutes} onChangeText={setTotalMinutes} keyboardType="number-pad" placeholder="Total min" style={[styles.input, styles.gridInput]} />
      </View>
      <TextInput accessibilityLabel="Tags" value={tags} onChangeText={setTags} placeholder="Tags, comma separated" style={styles.input} />
      <TextInput accessibilityLabel="Ingredients" value={ingredients} onChangeText={setIngredients} placeholder="Ingredients, one per line" multiline style={[styles.input, styles.area]} />
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
  starters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  starterChip: { minHeight: 38, borderRadius: 999, backgroundColor: Colors.softRed, borderColor: Colors.border, borderWidth: 1, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  starterText: { color: Colors.tomatoDark, fontWeight: "900" },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, backgroundColor: Colors.surface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridInput: { minWidth: 104, flex: 1 },
  area: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  preview: { width: "100%", aspectRatio: 1.55, borderRadius: 8, backgroundColor: Colors.border },
  emptyPreview: { width: "100%", aspectRatio: 1.55, borderRadius: 8, backgroundColor: Colors.softRed, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  emptyPreviewText: { color: Colors.muted, fontWeight: "800" },
  summary: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 10, gap: 4 },
  meta: { color: Colors.muted, lineHeight: 20 },
  warning: { color: Colors.danger, fontWeight: "700" },
  status: { color: Colors.basil, fontWeight: "800" }
});
