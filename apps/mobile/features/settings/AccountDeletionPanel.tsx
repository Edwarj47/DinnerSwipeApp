import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { ThemeColors, useThemedStyles, useThemeColors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { useAuthSession } from "@/services/session";

type DeletionStatus = {
  status: "not_requested" | "pending_manual_review";
  requested_at: string | null;
};

export function AccountDeletionPanel() {
  const session = useAuthSession();
  if (!session.authenticated || !session.email) return null;
  if (!session.userId) return <Text>Reconnect to confirm your account before managing deletion.</Text>;
  return <AuthenticatedDeletionPanel key={session.userId} owner={session.userId} />;
}

function AuthenticatedDeletionPanel({ owner }: { owner: string }) {
  const styles = useThemedStyles(createStyles);
  const Colors = useThemeColors();
  const client = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const statusKey = ["account-deletion-request", owner];
  const receipt = useQuery({
    queryKey: statusKey,
    queryFn: () => apiFetch<DeletionStatus>("/api/v1/auth/account/deletion-request", {
      headers: { "X-Dinner-Account": owner }
    }),
    retry: false,
    staleTime: 0,
    gcTime: 0
  });
  const request = useMutation({
    mutationFn: () => apiFetch<{ status: string }>("/api/v1/auth/account/delete-request", {
      method: "POST",
      headers: { "X-Dinner-Account": owner },
      body: JSON.stringify({ current_password: password, confirmation })
    }),
    onSuccess: async () => {
      setPassword("");
      setConfirmation("");
      setSubmitted(true);
      await client.invalidateQueries({ queryKey: statusKey });
    }
  });
  const pending = submitted || receipt.data?.status === "pending_manual_review";

  return <View style={styles.panel}>
    <Text style={styles.title}>Delete account request</Text>
    <Text style={styles.meta}>This requests deletion of your Dinner Swipe account and associated data. Requests currently require manual review; submitting this form does not erase your account immediately.</Text>
    <Text style={styles.meta}>A request does not cancel a subscription. Billing and shared group data must be resolved during review.</Text>
    {pending ? <View style={styles.receipt}>
      <Text accessibilityLiveRegion="polite" style={styles.receiptTitle}>Deletion request pending review</Text>
      {receipt.data?.requested_at ? <Text style={styles.meta}>Requested {new Date(receipt.data.requested_at).toLocaleDateString()}</Text> : null}
      <Text style={styles.meta}>Your account has not been deleted. Support: dinnerswipe@dcss.dev</Text>
    </View> : <>
      <Text style={styles.label}>Current password</Text>
      <TextInput accessibilityLabel="Password for account deletion request" secureTextEntry
        autoCapitalize="none" autoCorrect={false} autoComplete="current-password"
        value={password} onChangeText={setPassword} placeholder="Current password"
        placeholderTextColor={Colors.muted} style={styles.input} editable={!request.isPending} />
      <Text style={styles.label}>Confirmation</Text>
      <TextInput accessibilityLabel="Type DELETE to request account deletion" value={confirmation}
        onChangeText={setConfirmation} placeholder="Type DELETE" autoCapitalize="characters" autoCorrect={false}
        placeholderTextColor={Colors.muted} style={styles.input} editable={!request.isPending} />
      <Button label={request.isPending ? "Submitting request" : "Request deletion"} icon="trash" variant="danger"
        onPress={() => request.mutate()} disabled={password.length < 8 || confirmation !== "DELETE" || request.isPending} />
    </>}
    {request.isError ? <Text accessibilityRole="alert" style={styles.error}>{request.error instanceof Error ? request.error.message : "Unable to submit request. Try again."}</Text> : null}
    {receipt.isError ? <Text accessibilityRole="alert" style={styles.error}>Unable to check request status.</Text> : null}
    {receipt.isError || pending ? <Button label="Refresh request status" icon="refresh" disabled={receipt.isFetching || request.isPending} onPress={() => { void receipt.refetch(); }} /> : null}
  </View>;
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  panel: { gap: 12 },
  title: { color: Colors.ink, fontWeight: "900", fontSize: 20 },
  label: { color: Colors.ink, fontWeight: "700" },
  meta: { color: Colors.muted, lineHeight: 21 },
  receipt: { borderLeftWidth: 3, borderColor: Colors.basil, paddingLeft: 12, gap: 8 },
  receiptTitle: { color: Colors.ink, fontWeight: "800" },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, backgroundColor: Colors.surface, color: Colors.ink },
  error: { color: Colors.danger, lineHeight: 21 }
});
