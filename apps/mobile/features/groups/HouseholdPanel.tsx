import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { Household, Recipe, VoteSummary } from "@/services/types";

export function HouseholdPanel() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const { data: household } = useQuery({ queryKey: ["household"], queryFn: () => apiFetch<Household>("/api/v1/households/current") });
  const { data: recipes } = useQuery({ queryKey: ["recipes", "vote"], queryFn: () => apiFetch<Recipe[]>("/api/v1/recipes?limit=12") });
  const { data: votes } = useQuery({ queryKey: ["votes"], queryFn: () => apiFetch<VoteSummary>("/api/v1/households/current/votes") });
  const join = useMutation({
    mutationFn: () => apiFetch<Household>("/api/v1/households/join", { method: "POST", body: JSON.stringify({ invite_code: code }) }),
    onSuccess: async () => {
      setStatus("Joined dinner group.");
      setCode("");
      await queryClient.invalidateQueries({ queryKey: ["household"] });
    },
    onError: (error) => setStatus(String(error))
  });
  const vote = useMutation({
    mutationFn: (payload: { recipe_id: string; vote: "yes" | "maybe" | "no" }) =>
      apiFetch<VoteSummary>("/api/v1/households/current/votes", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["votes"] })
  });

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Dinner group</Text>
      {household ? (
        <View style={styles.invite}>
          <View>
            <Text style={styles.meta}>Invite code</Text>
            <Text style={styles.code}>{household.invite_code}</Text>
          </View>
          <Text style={styles.memberCount}>{household.members.length} member{household.members.length === 1 ? "" : "s"}</Text>
        </View>
      ) : null}
      <View style={styles.join}>
        <TextInput accessibilityLabel="Group invite code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="Join code" style={styles.input} />
        <Button label="Join" icon="people" onPress={() => join.mutate()} />
      </View>
      <Text style={styles.section}>Vote this week</Text>
      {votes?.top_match ? (
        <View style={styles.match}>
          <Text style={styles.meta}>Top group match</Text>
          <Text style={styles.matchName}>{votes.top_match.recipe_name}</Text>
          <Text style={styles.meta}>Score {votes.top_match.score} • Yes {votes.top_match.yes} • Maybe {votes.top_match.maybe}</Text>
        </View>
      ) : null}
      {(recipes ?? []).slice(0, 4).map((recipe) => {
        const summary = votes?.votes.find((item) => item.recipe_id === recipe.id);
        return (
          <View key={recipe.id} style={styles.voteRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.recipe}>{recipe.name}</Text>
              <Text style={styles.meta}>Yes {summary?.yes ?? 0} • Maybe {summary?.maybe ?? 0} • No {summary?.no ?? 0}</Text>
            </View>
            <View style={styles.voteButtons}>
              <Button label="Yes" icon="heart" variant="primary" onPress={() => vote.mutate({ recipe_id: recipe.id, vote: "yes" })} />
              <Button label="Maybe" icon="help-circle" onPress={() => vote.mutate({ recipe_id: recipe.id, vote: "maybe" })} />
              <Button label="No" icon="close-circle" onPress={() => vote.mutate({ recipe_id: recipe.id, vote: "no" })} />
            </View>
          </View>
        );
      })}
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 10, marginBottom: 12 },
  title: { fontSize: 19, fontWeight: "900", color: Colors.ink },
  invite: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  code: { color: Colors.tomatoDark, fontSize: 24, fontWeight: "900" },
  memberCount: { color: Colors.ink, fontWeight: "800" },
  join: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { minHeight: 48, flex: 1, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 },
  section: { color: Colors.ink, fontWeight: "900", fontSize: 16 },
  match: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 12 },
  matchName: { color: Colors.tomatoDark, fontWeight: "900", fontSize: 18 },
  voteRow: { gap: 10, paddingVertical: 10, borderTopColor: Colors.border, borderTopWidth: 1 },
  voteButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  recipe: { color: Colors.ink, fontWeight: "800" },
  meta: { color: Colors.muted, lineHeight: 20 },
  status: { color: Colors.basil, fontWeight: "800" }
});
