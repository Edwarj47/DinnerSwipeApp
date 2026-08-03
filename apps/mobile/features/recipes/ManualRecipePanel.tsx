import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";

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

export function ManualRecipePanel() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [instructions, setInstructions] = useState("");
  const [status, setStatus] = useState("");

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

  const create = useMutation({
    mutationFn: () => {
      const ingredientRows = splitLines(ingredients);
      const instructionRows = splitLines(instructions);
      return apiFetch<Recipe>("/api/v1/recipes", {
        method: "POST",
        body: JSON.stringify({
          name,
          photo_url: photoUrl || null,
          ingredients: ingredientRows.map((original_text, index) => ({ original_text, sort_order: index })),
          instructions: instructionRows.map((text, index) => ({ text, step_number: index + 1 })),
          source_type: "manual",
          accept_placeholder_photo: !photoUrl
        })
      });
    },
    onSuccess: async () => {
      setName("");
      setPhotoUrl("");
      setIngredients("");
      setInstructions("");
      setStatus("Recipe saved. It is ready for planning.");
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
    onError: (error) => setStatus(String(error))
  });

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Create recipe</Text>
        <Text style={styles.badge}>Manual</Text>
      </View>
      <Button
        label="Ranch starter"
        icon="create"
        onPress={() => {
          setName("Homemade Ranch");
          setIngredients(RANCH_INGREDIENTS);
          setInstructions("");
          setStatus("Ranch ingredients loaded from your screenshot. Add instructions before saving.");
        }}
      />
      <TextInput accessibilityLabel="Recipe name" value={name} onChangeText={setName} placeholder="Recipe name" style={styles.input} />
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
        <Text style={styles.meta}>Native photo picker is prepared for the next mobile build pass.</Text>
      )}
      <TextInput accessibilityLabel="Photo URL" value={photoUrl} onChangeText={setPhotoUrl} placeholder="Photo URL or upload result" autoCapitalize="none" style={styles.input} />
      <TextInput accessibilityLabel="Ingredients" value={ingredients} onChangeText={setIngredients} placeholder="Ingredients, one per line" multiline style={[styles.input, styles.area]} />
      <TextInput accessibilityLabel="Instructions" value={instructions} onChangeText={setInstructions} placeholder="Instructions, one step per line" multiline style={[styles.input, styles.area]} />
      <Button label="Save recipe" icon="save" variant="primary" onPress={() => create.mutate()} />
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 10, marginBottom: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 19, fontWeight: "900", color: Colors.ink },
  badge: { color: Colors.tomato, fontWeight: "900" },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, backgroundColor: Colors.surface },
  area: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  meta: { color: Colors.muted, lineHeight: 20 },
  status: { color: Colors.basil, fontWeight: "800" }
});
