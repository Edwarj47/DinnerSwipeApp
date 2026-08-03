import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { HouseholdPanel } from "@/features/groups/HouseholdPanel";
import { apiFetch, setToken } from "@/services/api";

export default function ProfileScreen() {
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ reset_token?: string }>();
  const [email, setEmail] = useState("test@example.com");
  const [password, setPassword] = useState("change-me-123");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (params.reset_token) setResetToken(String(params.reset_token));
  }, [params.reset_token]);
  const authStatus = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => apiFetch<{ email: string; email_verified: boolean; smtp_configured: boolean }>("/api/v1/auth/status"),
    retry: false
  });
  const auth = useMutation({
    mutationFn: (mode: "login" | "register") =>
      apiFetch<{ access_token: string }>(`/api/v1/auth/${mode}`, { method: "POST", body: JSON.stringify({ email, password }) }),
    onSuccess: async (data) => {
      await setToken(data.access_token);
      await queryClient.invalidateQueries({ queryKey: ["auth-status"] });
      setStatus("Signed in.");
    },
    onError: (error) => setStatus(String(error))
  });
  const resend = useMutation({
    mutationFn: () => apiFetch<{ status: string; sent: boolean }>("/api/v1/auth/resend-verification", { method: "POST" }),
    onSuccess: (data) => setStatus(data.sent ? "Verification email sent." : "SMTP is not configured yet."),
    onError: (error) => setStatus(String(error))
  });
  const requestReset = useMutation({
    mutationFn: () => apiFetch<{ status: string }>("/api/v1/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email }) }),
    onSuccess: () => setStatus("If the account exists, a reset email was sent."),
    onError: (error) => setStatus(String(error))
  });
  const confirmReset = useMutation({
    mutationFn: () => apiFetch<{ status: string }>("/api/v1/auth/password-reset/confirm", { method: "POST", body: JSON.stringify({ token: resetToken, password: newPassword }) }),
    onSuccess: () => {
      setResetToken("");
      setNewPassword("");
      setStatus("Password reset. Sign in with the new password.");
    },
    onError: (error) => setStatus(String(error))
  });
  return (
    <Screen>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>Household preferences, auth, Walmart ZIP, and notification settings are kept configurable for production setup.</Text>
      <View style={styles.panel}>
        <Text style={styles.section}>Account</Text>
        <TextInput autoCapitalize="none" accessibilityLabel="Email" value={email} onChangeText={setEmail} style={styles.input} />
        <TextInput accessibilityLabel="Password" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} />
        <View style={styles.actions}>
          <Button label="Register" icon="person-add" variant="primary" onPress={() => auth.mutate("register")} />
          <Button label="Sign in" icon="log-in" onPress={() => auth.mutate("login")} />
        </View>
        {authStatus.data ? (
          <View style={styles.securityBox}>
            <Text style={styles.meta}>{authStatus.data.email}</Text>
            <Text style={authStatus.data.email_verified ? styles.verified : styles.unverified}>
              {authStatus.data.email_verified ? "Email verified" : "Email not verified"}
            </Text>
            {!authStatus.data.email_verified ? (
              <Button label="Resend verification" icon="mail" onPress={() => resend.mutate()} />
            ) : null}
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button label="Email reset link" icon="mail-open" onPress={() => requestReset.mutate()} />
        </View>
        <TextInput accessibilityLabel="Reset token" value={resetToken} onChangeText={setResetToken} autoCapitalize="none" placeholder="Reset token from email link" style={styles.input} />
        <TextInput accessibilityLabel="New password" secureTextEntry value={newPassword} onChangeText={setNewPassword} placeholder="New password" style={styles.input} />
        <Button label="Set new password" icon="key" onPress={() => confirmReset.mutate()} />
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>
      <HouseholdPanel />
      <View style={styles.panel}>
        <Text style={styles.section}>Prepared integrations</Text>
        <Text style={styles.meta}>Expo SecureStore is used on native builds. Web uses local storage for development and should be hardened behind production auth settings before public launch.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: "900", color: Colors.ink },
  subtitle: { color: Colors.muted, marginBottom: 14 },
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 10, marginBottom: 12 },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 },
  actions: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  securityBox: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, gap: 6 },
  status: { color: Colors.basil, fontWeight: "700" },
  verified: { color: Colors.basil, fontWeight: "900" },
  unverified: { color: Colors.tomatoDark, fontWeight: "900" },
  section: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  meta: { color: Colors.muted, lineHeight: 20 }
});
