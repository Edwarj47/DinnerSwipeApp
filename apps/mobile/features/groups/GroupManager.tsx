import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import qrcode from "qrcode-generator";
import { useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { Household, PremiumStatus } from "@/services/types";
import { applyGroupChange } from "./groupAccess";
import { GroupJoinForm } from "./GroupJoinForm";

export function GroupManager({ current }: { current?: Household }) {
  const client = useQueryClient();
  const router = useRouter();
  const [action, setAction] = useState<"create" | "join" | "invite" | "leave" | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const groups = useQuery<Household[]>({ queryKey: ["households"], queryFn: () => apiFetch<Household[]>("/api/v1/households") });
  const groupList: Household[] = groups.data ?? [];
  const subscription = useQuery({ queryKey: ["subscription-status"], queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status") });
  const full = !subscription.data?.premium_active && groupList.filter(group => !group.is_personal).length >= 1;
  const switchGroup = useMutation({ mutationFn: (id: string) => apiFetch<Household>(`/api/v1/households/${id}/switch`, { method: "POST" }), onSuccess: group => applyGroupChange(client, group) });
  const create = useMutation({
    mutationFn: () => apiFetch<Household>("/api/v1/households", { method: "POST", body: JSON.stringify({ name: name.trim() }) }),
    onSuccess: async group => { await applyGroupChange(client, group); setName(""); setAction("invite"); }
  });
  const rotate = useMutation({
    mutationFn: () => apiFetch<Household>(`/api/v1/households/${current?.id}/rotate-invite`, { method: "POST" }),
    onSuccess: async group => { await applyGroupChange(client, group); setConfirmReset(false); setStatus("New invitation ready. Previous links and codes no longer work."); }
  });
  const leave = useMutation({
    mutationFn: () => apiFetch<Household>(`/api/v1/households/${current?.id}/leave`, { method: "POST" }),
    onSuccess: async group => { await applyGroupChange(client, group); setAction(null); }
  });
  const url = current?.invite_code ? `https://dinner.dcss.dev/join?code=${encodeURIComponent(current.invite_code)}` : "";
  const qr = useMemo(() => {
    if (!url) return "";
    const code = qrcode(0, "M"); code.addData(url); code.make();
    return code.createDataURL(6, 24);
  }, [url]);
  const busy = switchGroup.isPending || create.isPending || rotate.isPending || leave.isPending;
  const close = () => { if (!busy) { setAction(null); setStatus(""); setConfirmReset(false); create.reset(); rotate.reset(); leave.reset(); } };
  async function share() {
    try {
      if (Platform.OS === "web" && !navigator.share) {
        await navigator.clipboard.writeText(url);
        setStatus("Invitation link copied.");
      } else {
        await Share.share({ title: `Join ${current?.name}`, message: `Join ${current?.name} on Dinner Swipe: ${url}\nInvite code: ${current?.invite_code}` });
      }
    } catch { setStatus("Sharing was not completed. You can copy the invitation code below."); }
  }
  return <View style={styles.section}>
    <View style={styles.heading}><Text style={styles.title}>Your spaces</Text><Text style={styles.meta}>{subscription.data?.premium_active ? "Premium" : "Basic"}</Text></View>
    {groups.isLoading ? <Text style={styles.meta}>Loading groups...</Text> : null}
    {groups.isError ? <Button label="Retry groups" icon="refresh" onPress={() => { void groups.refetch(); }} /> : null}
    {groupList.map(group => <Pressable key={group.id} accessibilityRole="button" accessibilityLabel={`Switch to ${group.is_personal ? "My kitchen" : group.name}`} accessibilityState={{ selected: current?.id === group.id, disabled: busy }} disabled={busy || current?.id === group.id} onPress={() => switchGroup.mutate(group.id)} style={[styles.space, current?.id === group.id && styles.active]}>
      <Ionicons name={group.is_personal ? "person-outline" : "people-outline"} size={22} color={Colors.ink} />
      <View style={styles.copy}><Text style={styles.name}>{group.is_personal ? "My kitchen" : group.name}</Text><Text style={styles.meta}>{group.is_personal ? "Private" : `${group.members.length} members - ${group.current_user_role}`}</Text></View>
      {current?.id === group.id ? <Ionicons name="checkmark-circle" color={Colors.basil} size={22} /> : <Ionicons name="chevron-forward" color={Colors.muted} size={20} />}
    </Pressable>)}
    <View style={styles.actions}>
      <Button label="Create group" icon="add" disabled={busy} onPress={() => setAction("create")} />
      <Button label="Join group" icon="people-outline" disabled={busy} onPress={() => setAction("join")} />
      {current && !current.is_personal && current.current_user_role === "owner" ? <Button label="Invite" icon="share-social-outline" disabled={busy} onPress={() => setAction("invite")} /> : null}
      {current && !current.is_personal ? <Button label="Leave group" icon="exit-outline" disabled={busy} onPress={() => setAction("leave")} /> : null}
    </View>
    {switchGroup.error ? <Text accessibilityRole="alert" style={styles.error}>{switchGroup.error.message}</Text> : null}
    {action ? <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}><View style={styles.modal} accessibilityViewIsModal><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
        <View style={styles.heading}><Text style={styles.title}>{action === "leave" ? "Leave this group?" : action === "invite" ? "Invite to your group" : action === "create" ? "Create a group" : "Join a group"}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close group dialog" disabled={busy} onPress={close} style={styles.close}><Ionicons name="close" size={24} color={Colors.ink} /></Pressable></View>
        {(action === "create" || action === "join") && full ? <>
          <Text style={styles.meta}>Basic includes a private kitchen and one shared group. Premium lets you create or join unlimited groups.</Text>
          <Button label="View Premium" icon="star-outline" onPress={() => { close(); router.push({ pathname: "/profile", params: { section: "premium" } }); }} />
        </> : null}
        {action === "create" && !full ? <>
          <TextInput accessibilityLabel="Group name" placeholder="Group name" maxLength={120} value={name} onChangeText={setName} editable={!busy} style={styles.input} />
          <Button label={create.isPending ? "Creating..." : "Create group"} icon="add" variant="primary" disabled={!name.trim() || busy} onPress={() => create.mutate()} />
        </> : null}
        {action === "join" ? <GroupJoinForm onJoined={close} /> : null}
        {action === "leave" ? <>
          <Text style={styles.meta}>Your own recipes and meal plan stay with you. Recipes already shared remain in the group. Owners must transfer ownership before leaving if other members remain.</Text>
          <Button label="Confirm leave" icon="exit-outline" disabled={busy} onPress={() => leave.mutate()} />
          {leave.error ? <Text accessibilityRole="alert" style={styles.error}>{leave.error.message}</Text> : null}
        </> : null}
        {action === "invite" && url ? <>
          <Text style={styles.name}>{current?.name}</Text>
          <Image accessibilityLabel="Group invitation QR code" source={{ uri: qr }} style={styles.qr} contentFit="contain" />
          <Text selectable style={styles.code}>{current?.invite_code}</Text>
          <Button label="Share invitation" icon="share-social-outline" variant="primary" onPress={() => { void share(); }} />
          <Text selectable style={styles.link}>{url}</Text>
          {!confirmReset ? <Button label="Reset invitation" icon="refresh-outline" onPress={() => setConfirmReset(true)} /> : <>
            <Text style={styles.meta}>Resetting disables every previously shared link and QR code. Existing members stay in the group.</Text>
            <Button label="Confirm reset" icon="refresh" disabled={busy} onPress={() => rotate.mutate()} />
          </>}
        </> : null}
        {status ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{status}</Text> : null}
        {create.error || rotate.error ? <Text accessibilityRole="alert" style={styles.error}>{(create.error ?? rotate.error)?.message}</Text> : null}
      </ScrollView></View></View>
    </Modal> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, paddingBottom: 20 }, heading: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 20, fontWeight: "800", color: Colors.ink, flex: 1 },
  space: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 72, padding: 12, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, backgroundColor: Colors.surface },
  active: { borderColor: Colors.basil, backgroundColor: "#f0f7f1" }, copy: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: "800", color: Colors.ink }, meta: { color: Colors.muted, lineHeight: 22 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, error: { color: Colors.danger },
  backdrop: { flex: 1, padding: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  modal: { width: "100%", maxWidth: 480, maxHeight: "90%", borderRadius: 8, backgroundColor: Colors.surface },
  modalContent: { padding: 20, gap: 14 }, close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, minHeight: 48, padding: 12, color: Colors.ink },
  qr: { width: 220, height: 220, maxWidth: "100%", alignSelf: "center", backgroundColor: "#fff" },
  code: { textAlign: "center", fontSize: 24, fontWeight: "800", color: Colors.ink }, link: { color: Colors.muted, fontSize: 12 }
});
