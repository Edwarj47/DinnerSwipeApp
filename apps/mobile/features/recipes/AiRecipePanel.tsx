import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { AiRecipeJob } from "./aiRecipeTypes";
import { ManualRecipePanel } from "./ManualRecipePanel";
import { appendRecipeImage, RecipeImage, RecipePhotoPicker } from "./RecipePhotoPicker";

type Usage = { used: number; limit: number | null; remaining: number | null; resets_at: string; enabled: boolean };

export function AiRecipePanel() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<RecipeImage | null>(null);
  const [preview, setPreview] = useState("");
  const [selected, setSelected] = useState<AiRecipeJob | null>(null);
  const [status, setStatus] = useState("");
  const requestId = useRef("");
  const usage = useQuery({ queryKey: ["ai-recipe-usage"], queryFn: () => apiFetch<Usage>("/api/v1/ai-recipes/usage"), retry: false, refetchInterval: 60_000 });
  const drafts = useQuery({ queryKey: ["ai-recipe-drafts"], queryFn: () => apiFetch<AiRecipeJob[]>("/api/v1/ai-recipes"), retry: false });
  useEffect(() => {
    const url = image?.file ? URL.createObjectURL(image.file) : image?.uri ?? "";
    setPreview(url);
    return () => { if (image?.file) URL.revokeObjectURL(url); };
  }, [image]);
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["ai-recipe-usage"] });
    await queryClient.invalidateQueries({ queryKey: ["ai-recipe-drafts"] });
  }
  const generate = useMutation({
    mutationFn: () => {
      requestId.current ||= `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      const form = new FormData();
      form.append("request_id", requestId.current);
      form.append("description", description);
      if (image) appendRecipeImage(form, "image", image);
      return apiFetch<AiRecipeJob>("/api/v1/ai-recipes", { method: "POST", body: form });
    },
    onSuccess: (job) => { setSelected(job); setStatus(""); requestId.current = ""; },
    onSettled: refresh
  });
  const discard = useMutation({
    mutationFn: () => apiFetch(`/api/v1/ai-recipes/${selected?.id}/discard`, { method: "POST" }),
    onSuccess: async () => { setSelected(null); setStatus("Draft discarded."); await refresh(); }
  });
  if (selected?.draft) return <View style={styles.section}>
    <View style={styles.actions}>
      <Button label="Back to drafts" icon="arrow-back" onPress={() => { setSelected(null); void refresh(); }} />
      <Button label="Discard draft" icon="trash-outline" disabled={discard.isPending} onPress={() => discard.mutate()} />
    </View>
    <Text style={styles.meta}>Review ingredients, nutrition and serving sizes before saving.</Text>
    {selected.draft.review_notes.map((note, index) => <Text key={index} style={styles.note}>{note}</Text>)}
    {discard.error ? <Text style={styles.error}>{discard.error.message}</Text> : null}
    <ManualRecipePanel key={selected.id} initialDraft={selected} onSaved={() => { setSelected(null); setDescription(""); setImage(null); setStatus("Recipe saved."); void refresh(); }} />
  </View>;
  return <View style={styles.section}>
    <Text style={styles.title}>Create with AI</Text>
    <Text style={styles.meta}>{usage.data?.limit === null ? "Premium: unlimited AI recipes." : usage.data ? `${usage.data.remaining} of 3 AI recipes left this month. Resets ${new Date(usage.data.resets_at).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} (UTC).` : "Checking AI access..."}</Text>
    {usage.data?.limit !== null ? <Text style={styles.meta}>Drafts count even when discarded.</Text> : null}
    {usage.data?.remaining === 0 ? <Button label="View Premium" icon="star-outline" onPress={() => router.push({ pathname: "/profile", params: { section: "account" } })} /> : null}
    <TextInput accessibilityLabel="Recipe idea" placeholder="Describe your recipe" value={description} maxLength={6000}
      editable={!generate.isPending} multiline style={styles.input} onChangeText={value => { setDescription(value); requestId.current = ""; }} />
    <RecipePhotoPicker disabled={generate.isPending} onSelect={value => { setImage(value); requestId.current = ""; }} />
    {preview ? <View style={{ gap: 8 }}>
      <Image source={{ uri: preview }} style={styles.preview} contentFit="contain" />
      <Button label="Remove photo" icon="close" disabled={generate.isPending} onPress={() => { setImage(null); requestId.current = ""; }} />
    </View> : null}
    {usage.data && !usage.data.enabled ? <Text style={styles.meta}>AI recipes are currently unavailable.</Text> : null}
    <Button label={generate.isPending ? "Preparing draft..." : "Create draft"} icon="sparkles-outline" variant="primary"
      disabled={generate.isPending || !usage.data?.enabled || usage.data.remaining === 0 || (!description.trim() && !image)} onPress={() => generate.mutate()} />
    {generate.error ? <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={styles.error}>{generate.error.message}</Text>
      <Button label="Try again" icon="refresh" onPress={() => { requestId.current = ""; generate.reset(); }} />
    </View> : null}
    {usage.isError || drafts.isError ? <View style={{ gap: 8 }}><Text style={styles.error}>Unable to load AI recipes.</Text><Button label="Retry" icon="refresh" onPress={() => { void refresh(); }} /></View> : null}
    {status ? <Text accessibilityLiveRegion="polite" style={styles.note}>{status}</Text> : null}
    {drafts.data?.length ? <Text style={styles.title}>Your drafts</Text> : null}
    {drafts.data?.map((job: AiRecipeJob) => <View key={job.id} style={styles.draftRow}>
      <Text style={[styles.title, { flex: 1, fontSize: 16 }]}>{job.draft?.name ?? "Recipe draft"}</Text>
      <Button label="Review" icon="create-outline" onPress={() => { discard.reset(); setSelected(job); }} />
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, paddingVertical: 16 },
  title: { fontSize: 20, fontWeight: "900", color: Colors.ink },
  meta: { color: Colors.muted, lineHeight: 20 },
  note: { color: Colors.basil, lineHeight: 20 },
  error: { color: Colors.danger, lineHeight: 20 },
  input: { minHeight: 120, backgroundColor: Colors.surface, color: Colors.ink, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, padding: 12, textAlignVertical: "top" },
  preview: { width: "100%", aspectRatio: 1.5, backgroundColor: Colors.surface, borderRadius: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  draftRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: Colors.border }
});
