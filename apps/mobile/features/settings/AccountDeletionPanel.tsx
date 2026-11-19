import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import * as Linking from "expo-linking";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { ThemeColors, useThemedStyles, useThemeColors } from "@/components/theme";
import { apiFetch, clearAuthTokens, getStoredSessionIdentity } from "@/services/api";
import { eraseLocalAccountData, ErasureReceipt, useErasureReceipt } from "@/services/accountErasure";
import { useAuthSession } from "@/services/session";

type DeletionStatus = {
  status: "not_requested" | "pending_manual_review";
  requested_at: string | null;
};
type ErasurePreflight = {
  enabled: boolean; can_delete: boolean; ownership_transfers: { id: string; name: string }[];
  billing_acknowledgement_required: boolean; personal_space_requires_review: boolean;
  billing_providers?: string[];
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
  const preflight = useQuery({
    queryKey: ["account-erasure-preflight", owner],
    queryFn: () => apiFetch<ErasurePreflight>("/api/v1/auth/account/deletion", { headers: { "X-Dinner-Account": owner } }),
    retry: false, staleTime: 0, gcTime: 0
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

  if (preflight.data?.enabled) return <EraseAccountForm owner={owner} preflight={preflight.data} />;

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

function EraseAccountForm({ owner, preflight }: { owner: string; preflight: ErasurePreflight }) {
  const styles = useThemedStyles(createStyles);
  const Colors = useThemeColors();
  const client = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [billingAcknowledged, setBillingAcknowledged] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const openStore = async (provider: string) => {
    setLinkFailed(false);
    try { await Linking.openURL(provider === "apple" ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions"); }
    catch { setLinkFailed(true); }
  };
  const request = useMutation({
    mutationFn: async () => {
      const binding = await getStoredSessionIdentity();
      if (!binding || binding.owner !== owner || !binding.isCurrent()) throw new Error("Account changed. Reopen account settings.");
      const receipt = await apiFetch<ErasureReceipt>("/api/v1/auth/account/erase", {
        method: "POST", headers: { "X-Dinner-Account": owner },
        body: JSON.stringify({ current_password: password, confirmation, billing_acknowledged: billingAcknowledged })
      });
      if (!["complete", "cleanup_pending", "pending"].includes(receipt.status) || !receipt.receipt_id) throw new Error("Unable to confirm the deletion receipt. Contact support before retrying.");
      return { receipt, binding };
    },
    onSuccess: async ({ receipt, binding }) => {
      setPassword("");
      if (!binding.isCurrent()) return;
      await client.cancelQueries();
      let deviceCleanupPending = false;
      try { await eraseLocalAccountData(owner); } catch { deviceCleanupPending = true; }
      if (!binding.isCurrent()) return;
      useErasureReceipt.setState({ receipt: { ...receipt, device_cleanup_pending: deviceCleanupPending } });
      client.clear();
      await clearAuthTokens();
    }
  });
  return <View style={styles.panel}>
    <Text style={styles.title}>Delete account</Text>
    <Text style={styles.meta}>This permanently removes your account, private recipes, nutrition and workout logs, settings, and pending changes. Your sessions will be signed out.</Text>
    <Text style={styles.meta}>Your original shared recipes and workouts will also be removed. Other members' independently saved copies and personal logs remain. Account deletion does not cancel an existing subscription.</Text>
    {preflight.billing_acknowledgement_required ? <Text style={styles.meta}>Cancel renewal with your purchasing provider if needed. You can delete now without waiting for cancellation, but a deleted account's purchases cannot automatically move to a new Dinner Swipe account.</Text> : null}
    {preflight.billing_providers?.filter(provider => provider === "apple" || provider === "google").map(provider => <Button key={provider} label={provider === "apple" ? "Apple subscriptions" : "Google Play subscriptions"} icon="open-outline" onPress={() => { void openStore(provider); }} disabled={request.isPending} />)}
    {linkFailed ? <Text accessibilityRole="alert" style={styles.error}>Unable to open subscriptions. Open your purchasing store's account settings to manage renewal.</Text> : null}
    {preflight.ownership_transfers.map(group => <Text key={group.id} style={styles.error}>Transfer ownership of {group.name} before continuing.</Text>)}
    {preflight.personal_space_requires_review ? <Text style={styles.error}>Your Personal space has another member. Contact dinnerswipe@dcss.dev before deleting it.</Text> : null}
    {preflight.billing_acknowledgement_required ? <View style={styles.acknowledgement}>
      <Text style={[styles.meta, { flex: 1 }]}>I understand that deleting my account does not cancel billing. I can manage any existing renewal through its payment provider.</Text>
      <Switch accessibilityLabel="Acknowledge ongoing subscription billing" value={billingAcknowledged} onValueChange={setBillingAcknowledged} disabled={request.isPending} />
    </View> : null}
    <Text style={styles.label}>Current password</Text>
    <TextInput accessibilityLabel="Password for permanent account deletion" secureTextEntry autoCapitalize="none" autoCorrect={false}
      autoComplete="current-password" value={password} onChangeText={setPassword} placeholder="Current password"
      placeholderTextColor={Colors.muted} style={styles.input} editable={!request.isPending} />
    <Text style={styles.label}>Confirmation</Text>
    <TextInput accessibilityLabel="Type DELETE to permanently delete account" value={confirmation} onChangeText={setConfirmation}
      placeholder="Type DELETE" placeholderTextColor={Colors.muted} autoCapitalize="characters" autoCorrect={false}
      style={styles.input} editable={!request.isPending} />
    <Button label={request.isPending ? "Deleting account" : "Permanently delete account"} icon="trash" variant="danger" onPress={() => request.mutate()}
      disabled={!preflight.can_delete || password.length < 8 || confirmation !== "DELETE" || request.isPending || (preflight.billing_acknowledgement_required && !billingAcknowledged)} />
    {request.isError ? <Text accessibilityRole="alert" style={styles.error}>{request.error instanceof Error ? request.error.message : "Unable to delete account."}</Text> : null}
  </View>;
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  panel: { gap: 12 },
  acknowledgement: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { color: Colors.ink, fontWeight: "900", fontSize: 20 },
  label: { color: Colors.ink, fontWeight: "700" },
  meta: { color: Colors.muted, lineHeight: 21 },
  receipt: { borderLeftWidth: 3, borderColor: Colors.basil, paddingLeft: 12, gap: 8 },
  receiptTitle: { color: Colors.ink, fontWeight: "800" },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, backgroundColor: Colors.surface, color: Colors.ink },
  error: { color: Colors.danger, lineHeight: 21 }
});
