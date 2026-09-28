import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { Household } from "@/services/types";
import { applyGroupChange, inviteCode } from "./groupAccess";

export function GroupJoinForm({ initialCode = "", onJoined }: { initialCode?: string; onJoined: () => void }) {
  const [value, setValue] = useState(initialCode);
  const client = useQueryClient();
  const code = inviteCode(value);
  const preview = useMutation({ mutationFn: () => apiFetch<{ id: string; name: string; member_count: number }>("/api/v1/households/invite-preview", {
    method: "POST", body: JSON.stringify({ invite_code: code })
  }) });
  const join = useMutation({
    mutationFn: () => apiFetch<Household>("/api/v1/households/join", { method: "POST", body: JSON.stringify({ invite_code: code }) }),
    onSuccess: async group => { await applyGroupChange(client, group); onJoined(); }
  });
  return <View style={styles.form}>
    <TextInput accessibilityLabel="Invitation code or link" placeholder="Invitation code or link" autoCapitalize="none" autoCorrect={false} value={value} onChangeText={text => { setValue(text); preview.reset(); join.reset(); }} editable={!join.isPending && !preview.isPending} style={styles.input} />
    {!preview.data ? <Button label={preview.isPending ? "Checking..." : "Review invitation"} icon="people-outline" disabled={!code || preview.isPending} onPress={() => preview.mutate()} /> : <>
      <Text style={styles.name}>{preview.data.name}</Text>
      <Text style={styles.meta}>{preview.data.member_count} member{preview.data.member_count === 1 ? "" : "s"}</Text>
      <Text style={styles.meta}>Your email and matched allergy or dislike preferences are visible to this group. Your personal meal plan stays private.</Text>
      <Button label={join.isPending ? "Joining..." : "Join group"} icon="people" variant="primary" disabled={join.isPending} onPress={() => join.mutate()} />
    </>}
    {preview.error || join.error ? <Text accessibilityRole="alert" style={styles.error}>{(preview.error ?? join.error)?.message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  form: { gap: 12 }, input: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, color: Colors.ink },
  name: { fontSize: 20, fontWeight: "800", color: Colors.ink }, meta: { color: Colors.muted, lineHeight: 22 }, error: { color: Colors.danger }
});
