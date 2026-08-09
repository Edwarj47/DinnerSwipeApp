import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { Household, SafetyFilterMode, VoteOption, VoteResult, VoteSummary } from "@/services/types";

const safetyModes: SafetyFilterMode[] = ["off", "warn", "block"];
const safetyLabels: Record<SafetyFilterMode, string> = {
  off: "Off",
  warn: "Warn",
  block: "Block"
};

export function HouseholdPanel() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [maxMinutes, setMaxMinutes] = useState("");
  const { data: household } = useQuery<Household>({ queryKey: ["household"], queryFn: () => apiFetch<Household>("/api/v1/households/current") });
  const { data: voteOptions } = useQuery<VoteOption[]>({
    queryKey: ["vote-options", maxMinutes],
    queryFn: () => apiFetch<VoteOption[]>(`/api/v1/households/current/vote-options?limit=12${maxMinutes ? `&max_total_minutes=${encodeURIComponent(maxMinutes)}` : ""}`)
  });
  const { data: votes } = useQuery<VoteSummary>({ queryKey: ["votes"], queryFn: () => apiFetch<VoteSummary>("/api/v1/households/current/votes") });
  const join = useMutation({
    mutationFn: () => apiFetch<Household>("/api/v1/households/join", { method: "POST", body: JSON.stringify({ invite_code: code }) }),
    onSuccess: async () => {
      setStatus("Joined dinner group.");
      setCode("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["household"] }),
        queryClient.invalidateQueries({ queryKey: ["vote-options"] })
      ]);
    },
    onError: (error) => setStatus(String(error))
  });
  const updateSettings = useMutation({
    mutationFn: (payload: { allergen_filter_mode: SafetyFilterMode; dislike_filter_mode: SafetyFilterMode }) =>
      apiFetch<Household>("/api/v1/households/current/settings", { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: async () => {
      setStatus("Group safety settings saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["household"] }),
        queryClient.invalidateQueries({ queryKey: ["vote-options"] })
      ]);
    },
    onError: (error) => setStatus(String(error))
  });
  const transferOwner = useMutation({
    mutationFn: (userId: string) => apiFetch<Household>("/api/v1/households/current/transfer-owner", { method: "POST", body: JSON.stringify({ user_id: userId }) }),
    onSuccess: async () => {
      setStatus("Group ownership transferred.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["household"] }),
        queryClient.invalidateQueries({ queryKey: ["votes"] }),
        queryClient.invalidateQueries({ queryKey: ["vote-options"] })
      ]);
    },
    onError: (error) => setStatus(String(error))
  });
  const vote = useMutation({
    mutationFn: (payload: { recipe_id: string; vote: "yes" | "maybe" | "no" }) =>
      apiFetch<VoteSummary>("/api/v1/households/current/votes", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["votes"] }),
    onError: (error) => setStatus(String(error))
  });

  const setSafetyMode = (field: "allergen_filter_mode" | "dislike_filter_mode", value: SafetyFilterMode) => {
    if (!household) return;
    updateSettings.mutate({
      allergen_filter_mode: field === "allergen_filter_mode" ? value : household.allergen_filter_mode,
      dislike_filter_mode: field === "dislike_filter_mode" ? value : household.dislike_filter_mode
    });
  };

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
        <Button label="Join" icon="people" onPress={() => join.mutate()} disabled={join.isPending || !code.trim()} />
      </View>
      <Text style={styles.section}>Vote this week</Text>
      <View style={styles.filterRow}>
        <TextInput accessibilityLabel="Maximum cook time for group voting" value={maxMinutes} onChangeText={setMaxMinutes} keyboardType="number-pad" placeholder="Max minutes" style={styles.input} />
        <Text style={styles.meta}>Optional filter for this group vote list.</Text>
      </View>
      {votes?.top_match ? (
        <View style={styles.match}>
          <Text style={styles.meta}>Top group match</Text>
          <Text style={styles.matchName}>{votes.top_match.recipe_name}</Text>
          <Text style={styles.meta}>{majorityText(votes.top_match)} - {votes.top_match.total_votes} of {votes.total_members} voted</Text>
        </View>
      ) : null}
      {household && votes?.can_view_voters ? (
        <OwnerVoteDashboard
          household={household}
          votes={votes}
          onSetSafetyMode={setSafetyMode}
          onTransferOwner={(userId) => transferOwner.mutate(userId)}
          isSaving={updateSettings.isPending || transferOwner.isPending}
        />
      ) : null}
      {(voteOptions ?? ([] as VoteOption[])).slice(0, 4).map((option: VoteOption) => {
        const recipe = option.recipe;
        const summary = votes?.votes.find((item: VoteResult) => item.recipe_id === recipe.id);
        return (
          <View key={recipe.id} style={styles.voteRow}>
            <View style={styles.recipeHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.recipe}>{recipe.name}</Text>
                {option.warning_labels.length || option.blocked_labels.length ? (
                  <View style={styles.warningWrap}>
                    {[...option.warning_labels, ...option.blocked_labels].map((label) => (
                      <Text key={label} style={[styles.warningPill, option.blocked_labels.includes(label) ? styles.blockedPill : null]}>{label}</Text>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.safeText}>No group safety matches.</Text>
                )}
              </View>
              {recipe.total_minutes ? <Text style={styles.timePill}>{recipe.total_minutes} min</Text> : null}
            </View>
            {option.safety_notes.map((note: string) => <Text key={note} style={styles.meta}>{note}</Text>)}
            {summary ? <VoteChart result={summary} totalMembers={votes?.total_members ?? 0} canViewVoters={votes?.can_view_voters ?? false} /> : <Text style={styles.meta}>No votes yet.</Text>}
            <View style={styles.voteButtons}>
              <Button label="Yes" icon="heart" variant="primary" disabled={option.is_blocked || vote.isPending} onPress={() => vote.mutate({ recipe_id: recipe.id, vote: "yes" })} />
              <Button label="Maybe" icon="help-circle" disabled={option.is_blocked || vote.isPending} onPress={() => vote.mutate({ recipe_id: recipe.id, vote: "maybe" })} />
              <Button label="No" icon="close-circle" disabled={option.is_blocked || vote.isPending} onPress={() => vote.mutate({ recipe_id: recipe.id, vote: "no" })} />
            </View>
          </View>
        );
      })}
      {voteOptions?.length === 0 ? <Text style={styles.meta}>No recipes match the current group filters.</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

function VoteChart({ result, totalMembers, canViewVoters }: { result: VoteResult; totalMembers: number; canViewVoters: boolean }) {
  const rows = (["yes", "maybe", "no"] as const).filter((key) => result[key] > 0);
  return (
    <View style={styles.chart}>
      <Text style={styles.meta}>{majorityText(result)} - {result.total_votes} of {totalMembers} voted</Text>
      {rows.map((key) => {
        const percent = result.percentages[key] ?? 0;
        return (
          <View key={key} style={styles.barRow}>
            <Text style={styles.barLabel}>{key}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, key === "no" ? styles.noFill : key === "maybe" ? styles.maybeFill : null, { width: `${Math.max(8, percent)}%` }]} />
            </View>
            <Text style={styles.barCount}>{result[key]} / {percent}%</Text>
          </View>
        );
      })}
      {canViewVoters && result.voters?.length ? (
        <View style={styles.voters}>
          {result.voters.map((voter) => (
            <Text key={`${voter.email}-${voter.vote}`} style={styles.voterText}>{voter.email}: {voter.vote}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function OwnerVoteDashboard({
  household,
  votes,
  onSetSafetyMode,
  onTransferOwner,
  isSaving
}: {
  household: Household;
  votes: VoteSummary;
  onSetSafetyMode: (field: "allergen_filter_mode" | "dislike_filter_mode", value: SafetyFilterMode) => void;
  onTransferOwner: (userId: string) => void;
  isSaving: boolean;
}) {
  const voterEmails = new Set<string>();
  for (const result of votes.votes) {
    for (const voter of result.voters ?? []) {
      voterEmails.add(voter.email);
    }
  }
  const pendingMembers = household.members.filter((member) => !voterEmails.has(member.email));
  const activeChoices = votes.votes.filter((result) => result.total_votes > 0);
  const transferableMembers = household.members.filter((member) => member.role !== "owner");
  return (
    <View style={styles.ownerDashboard}>
      <Text style={styles.section}>Owner tools</Text>
      <View style={styles.ownerMetrics}>
        <OwnerMetric label="Voted" value={`${voterEmails.size}/${votes.total_members}`} />
        <OwnerMetric label="Choices" value={String(activeChoices.length)} />
        <OwnerMetric label="Pending" value={String(pendingMembers.length)} />
      </View>
      {activeChoices.length ? (
        <View style={styles.ownerList}>
          {activeChoices.slice(0, 3).map((result) => (
            <Text key={result.recipe_id} style={styles.ownerLine}>
              {result.recipe_name}: {result.yes} yes, {result.maybe} maybe, {result.no} no
            </Text>
          ))}
        </View>
      ) : null}
      {pendingMembers.length ? (
        <Text style={styles.meta}>Waiting on {pendingMembers.map((member) => member.email).join(", ")}</Text>
      ) : null}
      <View style={styles.safetyBox}>
        <Text style={styles.section}>Group safety</Text>
        <Text style={styles.meta}>Warnings may reveal matched allergens or dislikes to people in this group.</Text>
        <ModeControl label="Allergens" value={household.allergen_filter_mode} disabled={isSaving} onChange={(value) => onSetSafetyMode("allergen_filter_mode", value)} />
        <ModeControl label="Dislikes" value={household.dislike_filter_mode} disabled={isSaving} onChange={(value) => onSetSafetyMode("dislike_filter_mode", value)} />
      </View>
      {transferableMembers.length ? (
        <View style={styles.transferBox}>
          <Text style={styles.section}>Transfer owner</Text>
          <Text style={styles.meta}>The new owner can manage group safety and see voter detail.</Text>
          {transferableMembers.map((member) => (
            <View key={member.id} style={styles.memberRow}>
              <Text style={styles.memberEmail}>{member.email}</Text>
              <Button label="Make owner" icon="swap-horizontal" disabled={isSaving} onPress={() => onTransferOwner(member.id)} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ModeControl({ label, value, disabled, onChange }: { label: string; value: SafetyFilterMode; disabled: boolean; onChange: (value: SafetyFilterMode) => void }) {
  return (
    <View style={styles.modeBlock}>
      <Text style={styles.modeLabel}>{label}</Text>
      <View style={styles.modeRow}>
        {safetyModes.map((mode) => (
          <Pressable
            key={mode}
            accessibilityRole="button"
            accessibilityLabel={`${label} ${safetyLabels[mode]}`}
            accessibilityState={{ selected: value === mode, disabled }}
            disabled={disabled}
            onPress={() => onChange(mode)}
            style={[styles.modeButton, value === mode ? styles.modeActive : null, disabled ? styles.modeDisabled : null]}
          >
            <Text style={[styles.modeButtonText, value === mode ? styles.modeActiveText : null]}>{safetyLabels[mode]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function OwnerMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.ownerMetric}>
      <Text style={styles.ownerMetricValue}>{value}</Text>
      <Text style={styles.ownerMetricLabel}>{label}</Text>
    </View>
  );
}

function majorityText(result: VoteResult) {
  if (result.majority_vote === "tied") return "Tied";
  return `${result.majority_vote[0].toUpperCase()}${result.majority_vote.slice(1)} leads`;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 10, marginBottom: 12 },
  title: { fontSize: 19, fontWeight: "900", color: Colors.ink },
  invite: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  code: { color: Colors.tomatoDark, fontSize: 24, fontWeight: "900" },
  memberCount: { color: Colors.ink, fontWeight: "800" },
  join: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { minHeight: 48, flex: 1, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, color: Colors.ink },
  section: { color: Colors.ink, fontWeight: "900", fontSize: 16 },
  filterRow: { gap: 6 },
  match: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 12 },
  matchName: { color: Colors.tomatoDark, fontWeight: "900", fontSize: 18 },
  ownerDashboard: { borderColor: Colors.border, borderWidth: 1, borderRadius: 8, padding: 10, gap: 10 },
  ownerMetrics: { flexDirection: "row", gap: 8 },
  ownerMetric: { flex: 1, backgroundColor: Colors.softRed, borderRadius: 8, minHeight: 58, alignItems: "center", justifyContent: "center" },
  ownerMetricValue: { color: Colors.tomatoDark, fontWeight: "900", fontSize: 18 },
  ownerMetricLabel: { color: Colors.muted, fontWeight: "800", fontSize: 11 },
  ownerList: { gap: 4 },
  ownerLine: { color: Colors.ink, fontWeight: "700", lineHeight: 20 },
  safetyBox: { borderTopColor: Colors.border, borderTopWidth: 1, paddingTop: 10, gap: 8 },
  modeBlock: { gap: 6 },
  modeLabel: { color: Colors.ink, fontWeight: "800" },
  modeRow: { flexDirection: "row", gap: 6 },
  modeButton: { flex: 1, minHeight: 40, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center", backgroundColor: Colors.surface },
  modeActive: { backgroundColor: Colors.tomato, borderColor: Colors.tomato },
  modeDisabled: { opacity: 0.5 },
  modeButtonText: { color: Colors.ink, fontWeight: "800" },
  modeActiveText: { color: "#fff" },
  transferBox: { borderTopColor: Colors.border, borderTopWidth: 1, paddingTop: 10, gap: 8 },
  memberRow: { gap: 8, borderRadius: 8, backgroundColor: Colors.softRed, padding: 10 },
  memberEmail: { color: Colors.ink, fontWeight: "800" },
  voteRow: { gap: 10, paddingVertical: 10, borderTopColor: Colors.border, borderTopWidth: 1 },
  recipeHeader: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  voteButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  recipe: { color: Colors.ink, fontWeight: "800" },
  warningWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  warningPill: { overflow: "hidden", borderRadius: 999, backgroundColor: "#fff7df", color: "#7a5200", fontWeight: "800", fontSize: 11, paddingHorizontal: 8, paddingVertical: 5 },
  blockedPill: { backgroundColor: Colors.softRed, color: Colors.danger },
  safeText: { color: Colors.basil, fontWeight: "700", fontSize: 12, marginTop: 5 },
  timePill: { color: Colors.tomatoDark, backgroundColor: Colors.softRed, borderRadius: 999, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5, fontWeight: "900", fontSize: 12 },
  chart: { gap: 6, marginTop: 6 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  barLabel: { width: 45, color: Colors.muted, fontWeight: "800", textTransform: "capitalize", fontSize: 12 },
  barTrack: { flex: 1, height: 9, borderRadius: 999, backgroundColor: Colors.border, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 999, backgroundColor: Colors.basil },
  maybeFill: { backgroundColor: Colors.corn },
  noFill: { backgroundColor: Colors.danger },
  barCount: { width: 50, color: Colors.muted, fontWeight: "800", fontSize: 12, textAlign: "right" },
  voters: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 8, gap: 3 },
  voterText: { color: Colors.muted, fontSize: 12, lineHeight: 17 },
  meta: { color: Colors.muted, lineHeight: 20 },
  status: { color: Colors.basil, fontWeight: "800" }
});
