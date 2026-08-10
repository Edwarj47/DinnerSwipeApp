import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Image } from "expo-image";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";

type Candidate = {
  id: string;
  source_url: string;
  status: string;
  recipe_name?: string;
  created_at?: string;
  warnings?: string[];
  extracted_data?: Record<string, unknown>;
  validation_warnings?: string[];
  confidence?: Record<string, unknown>;
};

export function UrlIngestionPanel() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [status, setStatus] = useState("");
  const [editName, setEditName] = useState("");
  const [editPhoto, setEditPhoto] = useState("");
  const [editIngredients, setEditIngredients] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const history = useQuery<Candidate[]>({
    queryKey: ["url-ingestion-history"],
    queryFn: () => apiFetch<Candidate[]>("/api/v1/url-ingestion")
  });

  function linesFrom(value: unknown) {
    if (!Array.isArray(value)) return "";
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const row = item as { original_text?: string; text?: string };
          return row.original_text ?? row.text ?? "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

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
      setEditName(String(full.extracted_data?.name ?? ""));
      setEditPhoto(String(full.extracted_data?.photo_url ?? ""));
      setEditIngredients(linesFrom(full.extracted_data?.ingredients));
      setEditInstructions(linesFrom(full.extracted_data?.instructions));
      setStatus("Recipe draft ready for review.");
      await queryClient.invalidateQueries({ queryKey: ["url-ingestion-history"] });
    }
  }

  async function openCandidate(candidateId: string) {
    const full = await apiFetch<Candidate>(`/api/v1/url-ingestion/${candidateId}`);
    setCandidate(full);
    setUrl(full.source_url);
    setEditName(String(full.extracted_data?.name ?? ""));
    setEditPhoto(String(full.extracted_data?.photo_url ?? ""));
    setEditIngredients(linesFrom(full.extracted_data?.ingredients));
    setEditInstructions(linesFrom(full.extracted_data?.instructions));
    setStatus("Review draft loaded.");
  }

  async function approve() {
    if (!candidate) return;
    const ingredients = editIngredients.split(/\n|;/).map((item) => item.trim()).filter(Boolean);
    const instructions = editInstructions.split(/\n|;/).map((item) => item.trim()).filter(Boolean);
    await apiFetch(`/api/v1/url-ingestion/${candidate.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        accept_placeholder_photo: !editPhoto,
        edits: {
          name: editName,
          photo_url: editPhoto || null,
          servings: Number(candidate.extracted_data?.servings ?? 4),
          prep_minutes: candidate.extracted_data?.prep_minutes ?? null,
          cook_minutes: candidate.extracted_data?.cook_minutes ?? null,
          total_minutes: candidate.extracted_data?.total_minutes ?? null,
          difficulty: String(candidate.extracted_data?.difficulty ?? "requires_review"),
          meal_type: String(candidate.extracted_data?.meal_type ?? "dinner"),
          source_type: String(candidate.extracted_data?.source_type ?? "url_html"),
          source_url: candidate.source_url,
          source_title: String(candidate.extracted_data?.source_title ?? ""),
          tags: Array.isArray(candidate.extracted_data?.tags) ? candidate.extracted_data.tags : [],
          ingredients: ingredients.map((original_text, index) => ({ original_text, sort_order: index })),
          instructions: instructions.map((text, index) => ({ text, step_number: index + 1 }))
        }
      })
    });
    setStatus("Approved into your recipe library.");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["recipes"] }),
      queryClient.invalidateQueries({ queryKey: ["url-ingestion-history"] })
    ]);
  }

  async function reject() {
    if (!candidate) return;
    await apiFetch(`/api/v1/url-ingestion/${candidate.id}/reject`, { method: "POST" });
    setStatus("Draft rejected.");
    setCandidate({ ...candidate, status: "rejected" });
    await queryClient.invalidateQueries({ queryKey: ["url-ingestion-history"] });
  }

  const warnings = friendlyWarnings(candidate?.validation_warnings ?? []);
  const hasIngredients = splitReviewLines(editIngredients).length > 0;
  const hasInstructions = splitReviewLines(editInstructions).length > 0;
  const canApprove = Boolean(candidate && editName.trim().length > 1 && hasIngredients && hasInstructions && candidate.status !== "approved" && candidate.status !== "rejected");

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Add from web</Text>
        <Text style={styles.badge}>Review required</Text>
      </View>
      <TextInput accessibilityLabel="Recipe URL" value={url} onChangeText={setUrl} placeholder="Paste a recipe link" autoCapitalize="none" style={styles.input} />
      <Button label="Fetch recipe" icon="link" variant="primary" onPress={() => void submit().catch((error) => setStatus(String(error)))} />
      {candidate ? (
        <View style={styles.review}>
          <View style={styles.reviewHeader}>
            <Text style={styles.reviewTitle}>Review recipe</Text>
            <Text style={[styles.statusPill, candidate.status === "approved" ? styles.approvedPill : candidate.status === "rejected" ? styles.rejectedPill : null]}>{candidate.status.replaceAll("_", " ")}</Text>
          </View>
          {editPhoto ? <Image source={{ uri: editPhoto }} style={styles.photo} contentFit="cover" /> : <View style={styles.emptyPhoto}><Text style={styles.emptyPhotoText}>Photo required or approve placeholder</Text></View>}
          <Text style={styles.inputLabel}>Name</Text>
          <TextInput accessibilityLabel="Review recipe name" value={editName} onChangeText={setEditName} style={styles.input} />
          <Text style={styles.inputLabel}>Photo</Text>
          <TextInput accessibilityLabel="Review recipe photo URL" value={editPhoto} onChangeText={setEditPhoto} autoCapitalize="none" style={styles.input} />
          <Text style={styles.meta}>{candidate.source_url}</Text>
          <View style={styles.metrics}>
            <Metric label="Ingredients" value={String(splitReviewLines(editIngredients).length)} />
            <Metric label="Steps" value={String(splitReviewLines(editInstructions).length)} />
          </View>
          {warnings.length ? (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeTitle}>Needs a quick look</Text>
              {warnings.map((warning) => <Text key={warning} style={styles.noticeText}>{warning}</Text>)}
            </View>
          ) : null}
          <Text style={styles.inputLabel}>Ingredients</Text>
          <TextInput accessibilityLabel="Review ingredients" value={editIngredients} onChangeText={setEditIngredients} multiline style={[styles.input, styles.area]} />
          <Text style={styles.inputLabel}>Instructions</Text>
          <TextInput accessibilityLabel="Review instructions" value={editInstructions} onChangeText={setEditInstructions} multiline style={[styles.input, styles.area]} />
          <View style={styles.reviewActions}>
            <Button label="Approve" icon="checkmark-circle" variant="primary" disabled={!canApprove} onPress={() => void approve().catch((error) => setStatus(String(error)))} />
            <Button label="Re-fetch" icon="refresh" onPress={() => void submit().catch((error) => setStatus(String(error)))} />
            <Button label="Reject" icon="close-circle" variant="danger" disabled={!candidate || candidate.status === "rejected"} onPress={() => void reject().catch((error) => setStatus(String(error)))} />
          </View>
        </View>
      ) : null}
      {(history.data ?? []).length ? (
        <View style={styles.history}>
          <Text style={styles.historyTitle}>Recent web drafts</Text>
          {(history.data ?? []).slice(0, 3).map((item: Candidate) => (
            <View key={item.id} style={styles.historyRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.historyName}>{item.recipe_name ?? "Untitled draft"}</Text>
                <Text style={styles.meta}>{item.status.replaceAll("_", " ")} • {friendlyWarnings(item.warnings ?? []).length} note{friendlyWarnings(item.warnings ?? []).length === 1 ? "" : "s"}</Text>
              </View>
              <Button label="Open" icon="open" onPress={() => void openCandidate(item.id).catch((error) => setStatus(String(error)))} />
            </View>
          ))}
        </View>
      ) : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

function splitReviewLines(value: string) {
  return value.split(/\n|;/).map((item) => item.trim()).filter(Boolean);
}

function friendlyWarnings(messages: string[]) {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of messages) {
    const message = readableWarning(raw);
    if (!message || seen.has(message)) continue;
    seen.add(message);
    cleaned.push(message);
  }
  return cleaned;
}

function readableWarning(raw: string) {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (!value) return "";
  if (lower.includes("timer_minutes") || lower.includes("single integer")) return "";
  if (lower.includes("ai ingestion is disabled") || lower.includes("openai_api_key")) {
    return "Automatic cleanup is not configured yet. Review the recipe before approving.";
  }
  if (lower.includes("ai normalization failed")) {
    return "Automatic cleanup had trouble with this page. Review the recipe before approving.";
  }
  if (lower.includes("ai normalization returned invalid")) {
    return "Automatic cleanup returned an unexpected format. Review the recipe before approving.";
  }
  if (lower === "missing photo") return "Add a photo link or approve a placeholder.";
  if (lower === "unsupported photo url") return "Use a secure image link or leave the photo blank for a placeholder.";
  if (lower === "blocked photo url") return "That photo link is blocked. Use another image or approve a placeholder.";
  if (lower === "empty ingredients") return "Add at least one ingredient.";
  if (lower === "empty instructions") return "Add at least one instruction step.";
  if (lower === "missing name") return "Add a recipe name.";
  if (lower === "missing servings") return "Serving size was not found. You can still approve after reviewing.";
  if (lower === "missing timing information") return "";
  return value.replaceAll("_", " ");
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 10, marginBottom: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 19, fontWeight: "900", color: Colors.ink },
  badge: { color: Colors.tomato, fontWeight: "900" },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 },
  inputLabel: { color: Colors.ink, fontWeight: "900", marginTop: 2 },
  area: { minHeight: 132, paddingTop: 12, paddingBottom: 12, textAlignVertical: "top", lineHeight: 21 },
  review: { gap: 10 },
  reviewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  reviewTitle: { color: Colors.ink, fontSize: 17, fontWeight: "900" },
  statusPill: { color: Colors.tomatoDark, backgroundColor: Colors.softRed, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontWeight: "900", overflow: "hidden", textTransform: "capitalize" },
  approvedPill: { color: Colors.basil },
  rejectedPill: { color: Colors.danger },
  photo: { width: "100%", aspectRatio: 1.65, borderRadius: 8, backgroundColor: Colors.border },
  emptyPhoto: { width: "100%", aspectRatio: 1.65, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.softRed, alignItems: "center", justifyContent: "center" },
  emptyPhotoText: { color: Colors.muted, fontWeight: "800" },
  metrics: { flexDirection: "row", gap: 8 },
  metric: { flex: 1, minHeight: 60, borderRadius: 8, backgroundColor: Colors.softRed, alignItems: "center", justifyContent: "center" },
  metricValue: { color: Colors.tomatoDark, fontSize: 18, fontWeight: "900" },
  metricLabel: { color: Colors.muted, fontSize: 11, fontWeight: "800" },
  noticeBox: { borderRadius: 8, borderWidth: 1, borderColor: "#f2c7bd", backgroundColor: "#fff8f4", padding: 10, gap: 4 },
  noticeTitle: { color: Colors.ink, fontWeight: "900" },
  noticeText: { color: Colors.muted, lineHeight: 19 },
  reviewActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  history: { gap: 8, borderTopColor: Colors.border, borderTopWidth: 1, paddingTop: 10 },
  historyTitle: { color: Colors.ink, fontWeight: "900" },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.softRed, borderRadius: 8, padding: 9 },
  historyName: { color: Colors.ink, fontWeight: "900" },
  name: { color: Colors.ink, fontSize: 17, fontWeight: "900" },
  meta: { color: Colors.muted, lineHeight: 20 },
  status: { color: Colors.basil, fontWeight: "800" }
});
