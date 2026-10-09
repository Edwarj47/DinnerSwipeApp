import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SearchField } from "@/components/SearchField";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { Household } from "@/services/types";
import { applyGroupChange } from "./groupAccess";
import { useSpace } from "./useSpace";

export function SpaceSelector({ label = "Planning for", purpose = "switch" }: { label?: string; purpose?: "switch" | "default" }) {
  const client = useQueryClient();
  const space = useSpace();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const groups = useQuery<Household[]>({ queryKey: ["households"], queryFn: () => apiFetch<Household[]>("/api/v1/households"), enabled: open || purpose === "default" });
  const groupList: Household[] = Array.isArray(groups.data) ? groups.data : [];
  const matches = groupList.filter(g => (g.is_personal ? "My Kitchen" : g.name).toLowerCase().includes(search.toLowerCase()));
  const selected = purpose === "default" ? groupList.find(group => group.is_default) ?? space.group : space.group;
  const selectedName = selected?.is_personal ? "My Kitchen" : selected?.name ?? "Choose a group";
  const change = useMutation({ mutationFn: (id: string) => apiFetch<Household>(`/api/v1/households/${id}/${purpose}`, { method: "POST" }),
    onSuccess: async group => { await applyGroupChange(client, group); setOpen(false); setSearch(""); } });
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selectedName}`} disabled={space.isLoading || change.isPending || (purpose === "default" && groups.isLoading)} onPress={() => setOpen(true)} style={styles.selector}>
      <Ionicons name={selected?.is_personal ? "home-outline" : "people-outline"} size={20} color={Colors.basil} />
      <View style={styles.copy}><Text style={styles.label}>{label}</Text><Text style={styles.name}>{selectedName}</Text></View>
      <Ionicons name="chevron-down" size={20} color={Colors.muted} />
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => { if (!change.isPending) setOpen(false); }}>
      <View style={styles.backdrop}><View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.header}><Text style={styles.title}>Choose a group</Text><Pressable accessibilityRole="button" accessibilityLabel="Close group selection" disabled={change.isPending} onPress={() => setOpen(false)} style={styles.icon}><Ionicons name="close" size={24} color={Colors.ink} /></Pressable></View>
        <SearchField accessibilityLabel="Search groups" placeholder="Search groups" value={search} onChangeText={setSearch} editable={!change.isPending} />
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
          {matches.map(g => <Pressable key={g.id} accessibilityRole="radio" accessibilityLabel={g.is_personal ? "My Kitchen" : g.name} accessibilityState={{ checked: g.id === selected?.id }} aria-checked={g.id === selected?.id} disabled={change.isPending} onPress={() => change.mutate(g.id)} style={styles.row}>
            <Ionicons name={g.is_personal ? "home-outline" : "people-outline"} size={22} color={Colors.basil} />
            <View style={styles.copy}><Text style={styles.name}>{g.is_personal ? "My Kitchen" : g.name}</Text><Text style={styles.label}>{g.is_personal ? "Personal" : g.current_user_role === "owner" ? "Owner" : "Member"}</Text></View>
            {g.id === selected?.id ? <Ionicons name="checkmark-circle" color={Colors.tomato} size={24} /> : null}
          </Pressable>)}
          {groups.isLoading ? <Text style={styles.label}>Loading groups...</Text> : null}
          {!groups.isLoading && !groups.isError && !matches.length ? <Text style={styles.label}>No groups found.</Text> : null}
        </ScrollView>
        {change.error || groups.error ? <Text accessibilityRole="alert" style={styles.error}>{(change.error ?? groups.error)?.message}</Text> : null}
      </View></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  selector: { borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 8 },
  copy: { flex: 1, minWidth: 0 }, label: { color: Colors.muted, fontSize: 13, lineHeight: 20 }, name: { color: Colors.ink, fontWeight: "700", fontSize: 16 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end", alignItems: "center" },
  sheet: { width: "100%", maxWidth: 600, maxHeight: "80%", backgroundColor: Colors.surface, padding: 20, borderTopLeftRadius: 8, borderTopRightRadius: 8, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 }, title: { flex: 1, fontSize: 22, fontWeight: "800", color: Colors.ink },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, input: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, color: Colors.ink },
  list: { flexGrow: 0 }, row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border }, error: { color: Colors.danger }
});
