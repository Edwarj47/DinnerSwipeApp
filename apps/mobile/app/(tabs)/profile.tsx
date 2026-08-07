import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Platform, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { HouseholdPanel } from "@/features/groups/HouseholdPanel";
import { PremiumMacroPanel } from "@/features/premium/PremiumMacroPanel";
import { apiFetch, clearAuthTokens, getRefreshToken, getToken, setAuthTokens } from "@/services/api";
import { BiometricSettings, authenticateForUnlock, getBiometricSettings, setBiometricPreference } from "@/services/biometrics";
import { UserProfile } from "@/services/types";

export default function ProfileScreen() {
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ reset_token?: string }>();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [householdSize, setHouseholdSize] = useState("2");
  const [weeklyTarget, setWeeklyTarget] = useState("5");
  const [maxCookMinutes, setMaxCookMinutes] = useState("");
  const [allergens, setAllergens] = useState("");
  const [dislikes, setDislikes] = useState("");
  const [status, setStatus] = useState("");
  const [changeCurrentPassword, setChangeCurrentPassword] = useState("");
  const [changeNewPassword, setChangeNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [biometricSettings, setBiometricSettings] = useState<BiometricSettings | null>(null);
  useEffect(() => {
    if (params.reset_token) setResetToken(String(params.reset_token));
  }, [params.reset_token]);
  const refreshBiometricSettings = useCallback(async () => {
    setBiometricSettings(await getBiometricSettings());
  }, []);
  useEffect(() => {
    void refreshBiometricSettings();
  }, [refreshBiometricSettings]);
  const authStatus = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => apiFetch<{ email: string; email_verified: boolean; smtp_configured: boolean }>("/api/v1/auth/status"),
    retry: false
  });
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<UserProfile>("/api/v1/profile"),
    retry: false
  });
  useEffect(() => {
    if (!profile.data) return;
    setHouseholdSize(String(profile.data.household_size));
    setWeeklyTarget(String(profile.data.weekly_meal_target));
    setMaxCookMinutes(profile.data.max_cook_minutes ? String(profile.data.max_cook_minutes) : "");
    setAllergens(profile.data.allergens.join(", "));
    setDislikes(profile.data.disliked_ingredients.join(", "));
  }, [profile.data]);
  const auth = useMutation({
    mutationFn: (mode: "login" | "register") =>
      apiFetch<{ access_token: string; refresh_token: string }>(`/api/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ email, password })
      }),
    onSuccess: async (data) => {
      await setAuthTokens(data);
      await queryClient.invalidateQueries({ queryKey: ["auth-status"] });
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      await refreshBiometricSettings();
      setStatus("Signed in.");
    },
    onError: (error) => setStatus(String(error))
  });
  const signOut = useMutation({
    mutationFn: async () => {
      try {
        const refreshToken = await getRefreshToken();
        await apiFetch<{ status: string }>("/api/v1/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refresh_token: refreshToken })
        });
      } finally {
        await clearAuthTokens();
        queryClient.clear();
      }
    },
    onSuccess: () => setStatus("Signed out on this device."),
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
  const changePassword = useMutation({
    mutationFn: () =>
      apiFetch<{ status: string }>("/api/v1/auth/password/change", {
        method: "POST",
        body: JSON.stringify({ current_password: changeCurrentPassword, new_password: changeNewPassword })
      }),
    onSuccess: () => {
      setChangeCurrentPassword("");
      setChangeNewPassword("");
      setStatus("Password changed.");
    },
    onError: (error) => setStatus(String(error))
  });
  const exportAccount = useMutation({
    mutationFn: () => apiFetch<Record<string, unknown>>("/api/v1/auth/account/export"),
    onSuccess: async (data) => {
      await deliverAccountExport(data);
      setStatus("Account export generated.");
    },
    onError: (error) => setStatus(String(error))
  });
  const deleteAccount = useMutation({
    mutationFn: () =>
      apiFetch<{ status: string }>("/api/v1/auth/account/delete-request", {
        method: "POST",
        body: JSON.stringify({ current_password: deletePassword, confirmation: deleteConfirmation })
      }),
    onSuccess: () => {
      setDeletePassword("");
      setDeleteConfirmation("");
      setStatus("Account deletion request recorded for manual review.");
    },
    onError: (error) => setStatus(String(error))
  });
  const saveProfile = useMutation({
    mutationFn: () =>
      apiFetch<UserProfile>("/api/v1/profile", {
        method: "PUT",
        body: JSON.stringify({
          household_size: Number(householdSize) || 2,
          weekly_meal_target: Number(weeklyTarget) || 5,
          max_cook_minutes: maxCookMinutes ? Number(maxCookMinutes) : null,
          difficulty_preference: profile.data?.difficulty_preference ?? null,
          dietary_preferences: profile.data?.dietary_preferences ?? [],
          allergens: listFromText(allergens),
          disliked_ingredients: listFromText(dislikes),
          favorite_proteins: profile.data?.favorite_proteins ?? [],
          budget_preference: profile.data?.budget_preference ?? null,
          walmart_zip: profile.data?.walmart_zip ?? null,
          notification_preferences: profile.data?.notification_preferences ?? {}
        })
      }),
    onSuccess: async () => {
      setStatus("Preferences saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profile"] }),
        queryClient.invalidateQueries({ queryKey: ["recipes"] }),
        queryClient.invalidateQueries({ queryKey: ["weekly-plan"] })
      ]);
    },
    onError: (error) => setStatus(String(error))
  });
  async function toggleBiometrics(enabled: boolean) {
    const settings = await getBiometricSettings();
    if (enabled) {
      const token = await getToken();
      if (!token) {
        setStatus("Sign in before enabling biometric unlock.");
        return;
      }
      if (!settings.supported) {
        setStatus(settings.hasHardware ? "Enroll biometrics in device settings first." : "This device does not support biometric unlock.");
        await refreshBiometricSettings();
        return;
      }
      const approved = await authenticateForUnlock(`Enable Dinner Swipe ${settings.label} unlock`);
      if (!approved) {
        setStatus("Biometric setup was cancelled.");
        await refreshBiometricSettings();
        return;
      }
    }
    await setBiometricPreference(enabled);
    await refreshBiometricSettings();
    setStatus(enabled ? `${settings.label} unlock enabled.` : "Biometric unlock disabled.");
  }
  return (
    <Screen>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>Household preferences, auth, Walmart ZIP, and notification settings are kept configurable for production setup.</Text>
      <View style={styles.panel}>
        <Text style={styles.section}>Account</Text>
        <TextInput autoCapitalize="none" accessibilityLabel="Email" value={email} onChangeText={setEmail} placeholder="Email" style={styles.input} />
        <TextInput accessibilityLabel="Password" secureTextEntry value={password} onChangeText={setPassword} placeholder="Password" style={styles.input} />
        <View style={styles.actions}>
          <Button label="Register" icon="person-add" variant="primary" disabled={auth.isPending} onPress={() => auth.mutate("register")} />
          <Button label="Sign in" icon="log-in" disabled={auth.isPending} onPress={() => auth.mutate("login")} />
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
            <Button label="Sign out" icon="log-out" onPress={() => signOut.mutate()} />
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
      <View style={styles.panel}>
        <Text style={styles.section}>Account settings</Text>
        <TextInput accessibilityLabel="Current password" secureTextEntry value={changeCurrentPassword} onChangeText={setChangeCurrentPassword} placeholder="Current password" style={styles.input} />
        <TextInput accessibilityLabel="New account password" secureTextEntry value={changeNewPassword} onChangeText={setChangeNewPassword} placeholder="New password" style={styles.input} />
        <Button label="Change password" icon="key" onPress={() => changePassword.mutate()} disabled={changePassword.isPending} />
        <View style={styles.divider} />
        <Button label="Export my data" icon="download" onPress={() => exportAccount.mutate()} disabled={exportAccount.isPending} />
        <Text style={styles.meta}>The export includes account, profile, household, recipe, weekly plan, grocery, URL-ingestion, and audit metadata. It excludes password hashes and tokens.</Text>
        <View style={styles.deleteBox}>
          <Text style={styles.deleteTitle}>Delete account request</Text>
          <Text style={styles.meta}>This records a request for manual review. It does not immediately remove recipes or household data.</Text>
          <TextInput accessibilityLabel="Password for account deletion request" secureTextEntry value={deletePassword} onChangeText={setDeletePassword} placeholder="Current password" style={styles.input} />
          <TextInput accessibilityLabel="Type DELETE to request account deletion" value={deleteConfirmation} onChangeText={setDeleteConfirmation} placeholder="Type DELETE" autoCapitalize="characters" style={styles.input} />
          <Button label="Request deletion" icon="trash" variant="danger" onPress={() => deleteAccount.mutate()} disabled={deleteConfirmation !== "DELETE" || deleteAccount.isPending} />
        </View>
      </View>
      <View style={styles.panel}>
        <Text style={styles.section}>Device security</Text>
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleTitle}>{biometricSettings?.label ? `Use ${biometricSettings.label}` : "Use biometrics"}</Text>
            <Text style={styles.meta}>
              {Platform.OS === "web"
                ? "Biometric unlock is available on Android and iOS builds."
                : biometricSettings?.supported
                  ? "Unlock the saved session on this device after sign-in."
                  : "Set up Face ID, fingerprint, or a device passcode to enable this."}
            </Text>
          </View>
          <Switch
            accessibilityLabel="Enable biometric unlock"
            value={Boolean(biometricSettings?.enabled)}
            disabled={Platform.OS === "web"}
            onValueChange={(value) => {
              void toggleBiometrics(value);
            }}
            thumbColor={biometricSettings?.enabled ? Colors.tomato : Colors.surface}
            trackColor={{ false: Colors.border, true: "#f4aaa8" }}
          />
        </View>
      </View>
      <View style={styles.panel}>
        <Text style={styles.section}>Meal preferences</Text>
        <View style={styles.grid}>
          <TextInput accessibilityLabel="Household size" value={householdSize} onChangeText={setHouseholdSize} keyboardType="number-pad" placeholder="Household size" style={[styles.input, styles.gridInput]} />
          <TextInput accessibilityLabel="Weekly dinner target" value={weeklyTarget} onChangeText={setWeeklyTarget} keyboardType="number-pad" placeholder="Weekly meals" style={[styles.input, styles.gridInput]} />
          <TextInput accessibilityLabel="Maximum preferred cook time" value={maxCookMinutes} onChangeText={setMaxCookMinutes} keyboardType="number-pad" placeholder="Max cook minutes" style={[styles.input, styles.gridInput]} />
        </View>
        <TextInput accessibilityLabel="Allergens" value={allergens} onChangeText={setAllergens} placeholder="Allergens, comma separated" style={styles.input} />
        <TextInput accessibilityLabel="Disliked ingredients" value={dislikes} onChangeText={setDislikes} placeholder="Disliked ingredients, comma separated" style={styles.input} />
        <Text style={styles.meta}>Allergens are stored per user. For now they are not automatically hidden from group voters.</Text>
        <Button label="Save preferences" icon="save" variant="primary" onPress={() => saveProfile.mutate()} />
      </View>
      <PremiumMacroPanel />
      <HouseholdPanel />
      <View style={styles.panel}>
        <Text style={styles.section}>Prepared integrations</Text>
        <Text style={styles.meta}>Expo SecureStore is used on native builds. Web uses local storage for development and should be hardened behind production auth settings before public launch.</Text>
        <View style={styles.actions}>
          <Button label="Privacy" icon="document-text" onPress={() => router.push("/privacy" as never)} />
          <Button label="Terms" icon="document-text" onPress={() => router.push("/terms" as never)} />
        </View>
      </View>
    </Screen>
  );
}

function listFromText(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function deliverAccountExport(data: Record<string, unknown>) {
  const json = JSON.stringify(data, null, 2);
  const filename = `dinner-swipe-export-${new Date().toISOString().slice(0, 10)}.json`;
  if (Platform.OS === "web" && typeof window !== "undefined" && typeof document !== "undefined") {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  await Share.share({ title: filename, message: json });
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: "900", color: Colors.ink },
  subtitle: { color: Colors.muted, marginBottom: 14 },
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 10, marginBottom: 12 },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridInput: { flex: 1, minWidth: 118 },
  actions: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  securityBox: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, gap: 6 },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
  deleteBox: { borderWidth: 1, borderColor: "#f0b6b2", backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, gap: 9 },
  deleteTitle: { color: Colors.danger, fontWeight: "900" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  toggleCopy: { flex: 1, gap: 4 },
  toggleTitle: { color: Colors.ink, fontWeight: "900", fontSize: 16 },
  status: { color: Colors.basil, fontWeight: "700" },
  verified: { color: Colors.basil, fontWeight: "900" },
  unverified: { color: Colors.tomatoDark, fontWeight: "900" },
  section: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  meta: { color: Colors.muted, lineHeight: 20 }
});
