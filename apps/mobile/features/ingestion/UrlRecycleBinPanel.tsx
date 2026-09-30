import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";

type RecycledCandidate = {
  id: string;
  source_url: string;
  status: string;
  recipe_name?: string | null;
  warnings?: string[];
  rejected_at?: string | null;
  restore_until?: string | null;
};

export function UrlRecycleBinPanel() {
  const queryClient = useQueryClient();
  const recycled = useQuery<RecycledCandidate[]>({
    queryKey: ["url-ingestion-recycle-bin"],
    queryFn: () => apiFetch<RecycledCandidate[]>("/api/v1/url-ingestion?recycled=true"),
    refetchInterval: 60_000
  });
  const restore = useMutation({
    mutationFn: (candidateId: string) =>
      apiFetch(`/api/v1/url-ingestion/${candidateId}/restore`, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["url-ingestion-history"] }),
        queryClient.invalidateQueries({ queryKey: ["url-ingestion-recycle-bin"] })
      ]);
    }
  });

  const items: RecycledCandidate[] = (recycled.data ?? []).filter((item: RecycledCandidate) => item.restore_until && new Date(utcTimestamp(item.restore_until)).getTime() > Date.now());
  if (!items.length) return null;

  return (
    <View style={styles.panel}>
      <View>
        <Text style={styles.title}>Recycle bin</Text>
        <Text style={styles.meta}>Rejected web drafts can be restored for 15 days.</Text>
      </View>
      {items.map((item) => (
        <View key={item.id} style={styles.row}>
          <View style={{ flex: 1, flexBasis: 180, minWidth: 160 }}>
            <Text style={styles.name}>{item.recipe_name ?? "Untitled web draft"}</Text>
            <Text style={styles.meta}>{restoreUntil(item.restore_until)}</Text>
          </View>
          <Button
            label="Restore"
            icon="refresh"
            disabled={restore.isPending}
            onPress={() => restore.mutate(item.id)}
          />
        </View>
      ))}
      {restore.error ? (
        <Text style={styles.error}>
          {restore.error instanceof Error ? restore.error.message : "Unable to restore this draft."}
        </Text>
      ) : null}
    </View>
  );
}

function utcTimestamp(value: string) {
  return /Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}
function restoreUntil(value: string | null | undefined) {
  if (!value) return "Expired";
  const date = new Date(utcTimestamp(value));
  return `Restore by ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderColor: Colors.border,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    marginBottom: 12
  },
  title: { color: Colors.ink, fontSize: 20, fontWeight: "900" },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    borderRadius: 8,
    backgroundColor: Colors.softRed,
    padding: 10
  },
  name: { color: Colors.ink, fontSize: 16, fontWeight: "900" },
  meta: { color: Colors.muted, lineHeight: 20 },
  error: { color: Colors.danger, fontWeight: "800" }
});
