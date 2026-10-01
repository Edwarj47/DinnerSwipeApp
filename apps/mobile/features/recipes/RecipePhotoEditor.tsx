import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";
import { appendRecipeImage, RecipeImage, RecipePhotoPicker } from "./RecipePhotoPicker";

export function RecipePhotoEditor({ recipe }: { recipe: Recipe }) {
  const client = useQueryClient();
  const [photo, setPhoto] = useState(recipe.photo_url);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setPhoto(recipe.photo_url); }, [recipe.photo_url]);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3500);
    return () => clearTimeout(timer);
  }, [saved]);
  const upload = useMutation({
    mutationFn: (image: RecipeImage) => {
      const form = new FormData();
      appendRecipeImage(form, "file", image);
      return apiFetch<Recipe>(`/api/v1/recipes/${recipe.id}/photo`, { method: "PUT", body: form });
    },
    onSuccess: async updated => {
      setPhoto(updated.photo_url);
      setEditing(false);
      setSaved(true);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["recipes"] }),
        client.invalidateQueries({ queryKey: ["weekly-plan"] })
      ]);
    }
  });
  return <View style={styles.section}>
    <Image source={{ uri: photo ?? undefined }} placeholder={require("../../assets/icon.png")}
      accessibilityLabel={recipe.name} style={styles.photo} contentFit="contain" />
    {recipe.can_edit ? editing ? <View style={styles.controls}>
      <RecipePhotoPicker disabled={upload.isPending} onSelect={async image => { setSaved(false); await upload.mutateAsync(image); }} />
      <Button label="Cancel" icon="close" disabled={upload.isPending} onPress={() => { setEditing(false); upload.reset(); }} />
    </View> : <View style={styles.controls}>
      <Button label={photo ? "Change photo" : "Add photo"} icon="camera-outline" onPress={() => { setSaved(false); setEditing(true); }} />
    </View> : null}
    {saved ? <Text accessibilityLiveRegion="polite" style={styles.status}>Photo updated.</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  photo: { width: "100%", aspectRatio: 1.25, borderRadius: 8, backgroundColor: Colors.border },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "flex-start" },
  status: { color: Colors.basil, fontWeight: "700" }
});
