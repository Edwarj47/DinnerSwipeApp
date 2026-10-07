import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { useTransientMessage } from "@/components/useTransientMessage";
import { apiFetch } from "@/services/api";
import { Household, SafetyFilterMode } from "@/services/types";
import { GroupManager } from "./GroupManager";
import { GroupPlanningPanel } from "./GroupPlanningPanel";
import { useSpace } from "./useSpace";

export function HouseholdPanel() {
  const space = useSpace();
  return <HouseholdContent key={space.key} household={space.group} />;
}

function HouseholdContent({ household }: { household?: Household }) {
  const client = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<Household["members"][number] | null>(null);
  const [status, setStatus] = useTransientMessage();
  const update = useMutation({ mutationFn: (payload: { allergen_filter_mode: SafetyFilterMode; dislike_filter_mode: SafetyFilterMode }) => apiFetch(`/api/v1/households/${household?.id}/settings`, { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: async () => { setStatus("Group settings saved."); await client.invalidateQueries(); } });
  const transfer = useMutation({ mutationFn: (id: string) => apiFetch(`/api/v1/households/${household?.id}/transfer-owner`, { method: "POST", body: JSON.stringify({ user_id: id }) }),
    onSuccess: async () => { setTransferTarget(null); setSettingsOpen(false); await client.invalidateQueries(); } });
  const owner = household?.current_user_role === "owner";
  return <View style={styles.panel}>
    <GroupManager current={household} />
    {household?.id && !household.is_personal ? <>
      <Text style={styles.title}>{household.name}</Text>
      <GroupPlanningPanel household={household} />
      {owner ? <Button label={settingsOpen ? "Close group settings" : "Group settings"} icon="settings-outline" onPress={() => setSettingsOpen(!settingsOpen)} /> : null}
      {owner && settingsOpen ? <View style={styles.settings}>
        <Text style={styles.heading}>Group safety</Text>
        {(["allergen_filter_mode", "dislike_filter_mode"] as const).map(field => <View key={field} style={styles.settings}>
          <Text style={styles.label}>{field === "allergen_filter_mode" ? "Allergens" : "Dislikes"}</Text>
          <SegmentedControl accessibilityLabel={field === "allergen_filter_mode" ? "Allergens" : "Dislikes"} value={household[field]} disabled={update.isPending}
            options={(["off", "warn", "block"] as const).map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
            onChange={value => update.mutate({ allergen_filter_mode: household.allergen_filter_mode, dislike_filter_mode: household.dislike_filter_mode, [field]: value })} />
        </View>)}
        {household.members.filter(m => m.role !== "owner").map(member => <View key={member.id} style={styles.member}>
          <Text style={styles.email}>{member.email}</Text><Button label="Make owner" icon="swap-horizontal" onPress={() => setTransferTarget(member)} />
        </View>)}
      </View> : null}
    </> : null}
    {status ? <Text accessibilityLiveRegion="polite" style={styles.success}>{status}</Text> : null}
    {update.error ? <Text accessibilityRole="alert" style={styles.error}>{update.error.message}</Text> : null}
    <Modal visible={!!transferTarget} transparent animationType="fade" onRequestClose={() => { if (!transfer.isPending) setTransferTarget(null); }}>
      <View style={styles.backdrop}><View style={styles.confirm} accessibilityViewIsModal>
        <Text style={styles.title}>Transfer ownership?</Text><Text style={styles.meta}>{transferTarget?.email} will manage this group. You will remain a member.</Text>
        <Button label="Make owner" icon="swap-horizontal" disabled={transfer.isPending} onPress={() => { if (transferTarget) transfer.mutate(transferTarget.id); }} />
        <Button label="Cancel" icon="close" disabled={transfer.isPending} onPress={() => setTransferTarget(null)} />
        {transfer.error ? <Text accessibilityRole="alert" style={styles.error}>{transfer.error.message}</Text> : null}
      </View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 12 }, title: { color: Colors.ink, fontSize: 20, fontWeight: "800" }, heading: { color: Colors.ink, fontSize: 18, fontWeight: "800" }, label: { color: Colors.ink, fontWeight: "700" },
  settings: { gap: 12 }, member: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center" }, email: { flex: 1, minWidth: 160, color: Colors.ink }, meta: { color: Colors.muted, lineHeight: 22 },
  success: { color: Colors.basil }, error: { color: Colors.danger }, backdrop: { flex: 1, padding: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" }, confirm: { padding: 20, gap: 14, width: "100%", maxWidth: 440, backgroundColor: Colors.surface, borderRadius: 8 }
});
