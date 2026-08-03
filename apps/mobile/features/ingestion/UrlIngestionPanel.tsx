import { useState } from "react";
import { Image } from "expo-image";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";

type Candidate = { id: string; source_url: string; status: string; extracted_data?: Record<string, unknown>; validation_warnings?: string[]; confidence?: Record<string, unknown> };

const EXAMPLE_LINKS = [
  { label: "Pico", url: "https://www.joyfulhealthyeats.com/pico-de-gallo/" },
  { label: "Fajitas", url: "https://www.joyfulhealthyeats.com/easy-sheet-pan-chicken-fajitas/" },
  { label: "Shrimp tacos", url: "https://natashaskitchen.com/bang-bang-shrimp-tacos/" },
  { label: "Alfredo", url: "https://valentinascorner.com/crockpot-chicken-alfredo/" },
  { label: "Chicken thighs", url: "https://easychickenrecipes.com/air-fryer-chicken-thighs/" },
  { label: "Turkey prep", url: "https://sweetpeasandsaffron.com/korean-turkey-meal-prep/" },
  { label: "Mousse", url: "https://at-my-table.com/high-protein-chocolate-mousse/#recipe" }
];

export function UrlIngestionPanel() {
  const [url, setUrl] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [status, setStatus] = useState("");

  async function submit() {
    setStatus("Fetching and checking the recipe page...");
    const result = await apiFetch<{ candidates: Candidate[] }>("/api/v1/url-ingestion", {
      method: "POST",
      body: JSON.stringify({ urls: [url] })
    });
    const first = result.candidates[0];
    if (first) {
      const full = await apiFetch<Candidate>(`/api/v1/url-ingestion/${first.id}`);
      setCandidate(full);
      setStatus("Recipe draft ready for review.");
    }
  }

  async function approve() {
    if (!candidate) return;
    await apiFetch(`/api/v1/url-ingestion/${candidate.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ accept_placeholder_photo: true })
    });
    setStatus("Approved into your recipe library.");
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Add from web</Text>
        <Text style={styles.badge}>Review required</Text>
      </View>
      <TextInput accessibilityLabel="Recipe URL" value={url} onChangeText={setUrl} placeholder="Paste a recipe link" autoCapitalize="none" style={styles.input} />
      <View style={styles.quickLinks}>
        {EXAMPLE_LINKS.map((item) => (
          <Button key={item.url} label={item.label} icon="restaurant" onPress={() => setUrl(item.url)} />
        ))}
      </View>
      <Button label="Fetch recipe" icon="link" variant="primary" onPress={() => void submit().catch((error) => setStatus(String(error)))} />
      {candidate ? (
        <View style={styles.review}>
          {candidate.extracted_data?.photo_url ? <Image source={{ uri: String(candidate.extracted_data.photo_url) }} style={styles.photo} contentFit="cover" /> : null}
          <Text style={styles.name}>{String(candidate.extracted_data?.name ?? "Requires review")}</Text>
          <Text style={styles.meta}>{candidate.source_url}</Text>
          <Text style={styles.meta}>{Array.isArray(candidate.extracted_data?.ingredients) ? `${candidate.extracted_data.ingredients.length} ingredients` : "Ingredients need review"} • {Array.isArray(candidate.extracted_data?.instructions) ? `${candidate.extracted_data.instructions.length} steps` : "Steps need review"}</Text>
          <Text style={styles.meta}>{(candidate.validation_warnings ?? []).join("; ") || "No blocking validation warnings returned."}</Text>
          <Button label="Approve to library" icon="checkmark-circle" onPress={() => void approve().catch((error) => setStatus(String(error)))} />
        </View>
      ) : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 10, marginBottom: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 19, fontWeight: "900", color: Colors.ink },
  badge: { color: Colors.tomato, fontWeight: "900" },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 },
  quickLinks: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  review: { gap: 8 },
  photo: { width: "100%", aspectRatio: 1.65, borderRadius: 8, backgroundColor: Colors.border },
  name: { color: Colors.ink, fontSize: 17, fontWeight: "900" },
  meta: { color: Colors.muted, lineHeight: 20 },
  status: { color: Colors.basil, fontWeight: "800" }
});
