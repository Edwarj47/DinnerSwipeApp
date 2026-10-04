import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { SUCCESS_MESSAGE_MS } from "@/components/useTransientMessage";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";
import { appendRecipeImage, RecipeImage, RecipePhotoPicker } from "./RecipePhotoPicker";
import { RecipePhoto } from "./RecipePhoto";

export function RecipePhotoEditor({ recipe, onUpdated }: { recipe: Recipe; onUpdated?: (recipe: Recipe) => void }) {
  const client = useQueryClient();
  const [photo, setPhoto] = useState(recipe.photo_url);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setPhoto(recipe.photo_url); }, [recipe.photo_url]);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SUCCESS_MESSAGE_MS);
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
      onUpdated?.(updated);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["recipes"] }),
        client.invalidateQueries({ queryKey: ["weekly-plan"] })
      ]);
    }
  });
  return <View style={styles.section}>
    <RecipePhoto photoUrl={photo}
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
