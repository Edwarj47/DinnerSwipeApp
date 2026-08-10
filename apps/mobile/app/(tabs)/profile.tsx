import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { HouseholdPanel } from "@/features/groups/HouseholdPanel";
import { PremiumMacroPanel } from "@/features/premium/PremiumMacroPanel";
import { apiFetch, clearAuthTokens, getRefreshToken, getToken, setAuthTokens } from "@/services/api";
import { BiometricSettings, authenticateForUnlock, getBiometricSettings, setBiometricPreference } from "@/services/biometrics";
import { openTutorial } from "@/services/tutorial";
import { UserProfile } from "@/services/types";

type ProfileSection = "account" | "meals" | "group" | "premium";
type AccountAction = "overview" | "reset" | "data" | "delete";

export default function ProfileScreen() {
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ reset_token?: string }>();
  const router = useRouter();
  const [section, setSection] = useState<ProfileSection>("account");
  const [accountAction, setAccountAction] = useState<AccountAction>("overview");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [householdSize, setHouseholdSize] = useState("2");
  const [weeklyTarget, setWeeklyTarget] = useState("5");
  const [maxCookMinutes, setMaxCookMinutes] = useState("");
  const [allergens, setAllergens] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [biometricSettings, setBiometricSettings] = useState<BiometricSettings | null>(null);
  useEffect(() => {
    if (params.reset_token) {
      setResetToken(String(params.reset_token));
      setSection("account");
      setAccountAction("reset");
    }
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
    setAllergens(profile.data.allergens);
    setDislikes(profile.data.disliked_ingredients);
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
    mutationFn: () =>
      apiFetch<{ status: string }>("/api/v1/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: (authStatus.data?.email ?? email).trim() })
      }),
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
          allergens: cleanList(allergens),
          disliked_ingredients: cleanList(dislikes),
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
      const approved = await authenticateForUnlock("Enable Biometrics");
      if (!approved) {
        setStatus("Biometric setup was cancelled.");
        await refreshBiometricSettings();
        return;
      }
    }
    await setBiometricPreference(enabled);
    await refreshBiometricSettings();
    setStatus(enabled ? "Biometrics enabled." : "Biometrics disabled.");
  }
  return (
    <Screen>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>Manage the account, meal preferences, group voting, and premium macros from focused sections.</Text>
      <SegmentedControl
        accessibilityLabel="Profile sections"
        value={section}
        onChange={setSection}
        options={[
          { label: "Account", value: "account" },
          { label: "Meals", value: "meals" },
          { label: "Group", value: "group" },
          { label: "Premium", value: "premium" }
        ]}
      />
      {status ? <Text style={styles.status}>{status}</Text> : null}
      {section === "account" ? (
        <>
          <View style={styles.panel}>
            <Text style={styles.section}>Account</Text>
            {authStatus.data ? (
              <View style={styles.securityBox}>
                <Text style={styles.meta}>{authStatus.data.email}</Text>
                <Text style={authStatus.data.email_verified ? styles.verified : styles.unverified}>
                  {authStatus.data.email_verified ? "Email verified" : "Email not verified"}
                </Text>
                <View style={styles.actions}>
                  {!authStatus.data.email_verified ? (
                    <Button label="Resend verification" icon="mail" onPress={() => resend.mutate()} />
                  ) : null}
                  <Button label="Replay tour" icon="play-circle" onPress={openTutorial} />
                  <Button label="Sign out" icon="log-out" onPress={() => signOut.mutate()} />
                </View>
              </View>
            ) : (
              <>
                <TextInput autoCapitalize="none" accessibilityLabel="Email" value={email} onChangeText={setEmail} placeholder="Email" style={styles.input} />
                <TextInput accessibilityLabel="Password" secureTextEntry value={password} onChangeText={setPassword} placeholder="Password" style={styles.input} />
                <View style={styles.actions}>
                  <Button label="Register" icon="person-add" variant="primary" disabled={auth.isPending} onPress={() => auth.mutate("register")} />
                  <Button label="Sign in" icon="log-in" disabled={auth.isPending} onPress={() => auth.mutate("login")} />
                </View>
              </>
            )}
          </View>
          <View style={styles.panel}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.section}>Account tools</Text>
                <Text style={styles.meta}>Choose an action when you need it.</Text>
              </View>
              {accountAction !== "overview" ? <Button label="Back" icon="arrow-back" onPress={() => setAccountAction("overview")} /> : null}
            </View>
            {accountAction === "overview" ? (
              <View style={styles.toolGrid}>
                <Button label="Reset password" icon="mail-open" onPress={() => setAccountAction("reset")} />
                <Button label="Data and legal" icon="document-text" onPress={() => setAccountAction("data")} />
                <Button label="Delete request" icon="trash" variant="danger" onPress={() => setAccountAction("delete")} />
              </View>
            ) : null}
            {accountAction === "reset" ? (
              <View style={styles.flowBox}>
                <Text style={styles.flowTitle}>Reset password</Text>
                <Text style={styles.meta}>We'll email a secure reset link to your account. Use this if you forgot your password or want to change it.</Text>
                <Button label="Send reset email" icon="mail-open" onPress={() => requestReset.mutate()} />
                <TextInput accessibilityLabel="Reset token" value={resetToken} onChangeText={setResetToken} autoCapitalize="none" placeholder="Reset token from email link" style={styles.input} />
                <TextInput accessibilityLabel="New password" secureTextEntry value={newPassword} onChangeText={setNewPassword} placeholder="New password" style={styles.input} />
                <Button label="Set new password" icon="key" variant="primary" onPress={() => confirmReset.mutate()} />
              </View>
            ) : null}
            {accountAction === "data" ? (
              <View style={styles.flowBox}>
                <Text style={styles.flowTitle}>Data and legal</Text>
                <Button label="Export my data" icon="download" onPress={() => exportAccount.mutate()} disabled={exportAccount.isPending} />
                <Text style={styles.meta}>The export excludes password hashes and tokens.</Text>
                <View style={styles.actions}>
                  <Button label="Privacy" icon="document-text" onPress={() => router.push("/privacy" as never)} />
                  <Button label="Terms" icon="document-text" onPress={() => router.push("/terms" as never)} />
                </View>
              </View>
            ) : null}
            {accountAction === "delete" ? (
              <View style={styles.deleteBox}>
                <Text style={styles.deleteTitle}>Delete account request</Text>
                <Text style={styles.meta}>This records a request for manual review. It does not immediately remove recipes or household data.</Text>
                <TextInput accessibilityLabel="Password for account deletion request" secureTextEntry value={deletePassword} onChangeText={setDeletePassword} placeholder="Current password" style={styles.input} />
                <TextInput accessibilityLabel="Type DELETE to request account deletion" value={deleteConfirmation} onChangeText={setDeleteConfirmation} placeholder="Type DELETE" autoCapitalize="characters" style={styles.input} />
                <Button label="Request deletion" icon="trash" variant="danger" onPress={() => deleteAccount.mutate()} disabled={deleteConfirmation !== "DELETE" || deleteAccount.isPending} />
              </View>
            ) : null}
          </View>
          <View style={styles.panel}>
            <Text style={styles.section}>Device security</Text>
            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <Text style={styles.toggleTitle}>Enable Biometrics</Text>
                <Text style={styles.meta}>
                  {Platform.OS === "web"
                    ? "Biometric unlock is available on Android and iOS builds."
                    : biometricSettings?.supported
                      ? `Use ${biometricSettings.label} when Dinner Swipe opens.`
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
        </>
      ) : null}
      {section === "meals" ? (
        <View style={styles.panel}>
          <Text style={styles.section}>Meal preferences</Text>
          <View style={styles.grid}>
            <TextInput accessibilityLabel="Household size" value={householdSize} onChangeText={setHouseholdSize} keyboardType="number-pad" placeholder="Household size" style={[styles.input, styles.gridInput]} />
            <TextInput accessibilityLabel="Weekly dinner target" value={weeklyTarget} onChangeText={setWeeklyTarget} keyboardType="number-pad" placeholder="Weekly meals" style={[styles.input, styles.gridInput]} />
            <TextInput accessibilityLabel="Maximum preferred cook time" value={maxCookMinutes} onChangeText={setMaxCookMinutes} keyboardType="number-pad" placeholder="Max cook minutes" style={[styles.input, styles.gridInput]} />
          </View>
          <TagEditor
            label="Allergens"
            placeholder="Add an allergen"
            values={allergens}
            onChange={setAllergens}
          />
          <TagEditor
            label="Disliked ingredients"
            placeholder="Add an ingredient"
            values={dislikes}
            onChange={setDislikes}
          />
          <Text style={styles.meta}>Allergens are stored per user. Group owners can warn or block matching recipes during group votes.</Text>
          <Button label="Save preferences" icon="save" variant="primary" onPress={() => saveProfile.mutate()} />
        </View>
      ) : null}
      {section === "group" ? <HouseholdPanel /> : null}
      {section === "premium" ? <PremiumMacroPanel /> : null}
    </Screen>
  );
}

function TagEditor({
  label,
  placeholder,
  values,
  onChange
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState("");

  function addRawValue(raw: string) {
    if (raw.includes(",")) {
      setInputError("Add one item at a time.");
      return;
    }
    const additions = cleanList([raw]);
    if (!additions.length) return;
    const existing = new Set(values.map((item) => item.toLowerCase()));
    const next = [...values];
    for (const item of additions) {
      if (!existing.has(item.toLowerCase())) {
        existing.add(item.toLowerCase());
        next.push(item);
      }
    }
    setInputError("");
    onChange(next);
  }

  function handleChange(text: string) {
    setDraft(text);
    setInputError(text.includes(",") ? "Add one item at a time." : "");
  }

  function submitDraft() {
    addRawValue(draft);
    setDraft("");
  }

  function removeValue(value: string) {
    onChange(values.filter((item) => item !== value));
  }

  return (
    <View style={styles.tagEditor}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.tagInputRow}>
        <TextInput
          accessibilityLabel={label}
          value={draft}
          onChangeText={handleChange}
          onSubmitEditing={submitDraft}
          returnKeyType="done"
          placeholder={placeholder}
          style={[styles.input, styles.tagInput]}
        />
        <Button label="Add" icon="add" onPress={submitDraft} disabled={!draft.trim()} />
      </View>
      {values.length ? (
        <View style={styles.chipRow}>
          {values.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${value}`}
              onPress={() => removeValue(value)}
              style={styles.chip}
            >
              <Text style={styles.chipText}>{value}</Text>
              <Text style={styles.chipRemove}>×</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.tagHint}>Add one item at a time. Tap a chip to remove it.</Text>
      )}
      {inputError ? <Text style={styles.tagError}>{inputError}</Text> : null}
    </View>
  );
}

function cleanList(values: string[]) {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const value of values) {
    const item = value.trim().replace(/\s+/g, " ");
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    cleaned.push(item);
  }
  return cleaned;
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
  subtitle: { color: Colors.muted, marginBottom: 14, lineHeight: 20 },
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 10, marginTop: 12 },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridInput: { flex: 1, minWidth: 118 },
  actions: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  sectionHeader: { flexDirection: "row", gap: 10, alignItems: "center" },
  toolGrid: { gap: 9 },
  flowBox: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, gap: 10 },
  flowTitle: { color: Colors.ink, fontWeight: "900", fontSize: 16 },
  securityBox: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, gap: 6 },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
  deleteBox: { borderWidth: 1, borderColor: "#f0b6b2", backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, gap: 9 },
  deleteTitle: { color: Colors.danger, fontWeight: "900" },
  tagEditor: { gap: 8 },
  inputLabel: { color: Colors.ink, fontWeight: "900" },
  tagInputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tagInput: { flex: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: Colors.softRed,
    borderColor: "#f4c4c0",
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 10,
    alignItems: "center",
    flexDirection: "row",
    gap: 7
  },
  chipText: { color: Colors.tomatoDark, fontWeight: "900" },
  chipRemove: { color: Colors.tomatoDark, fontWeight: "900", fontSize: 18, lineHeight: 20 },
  tagHint: { color: Colors.muted, lineHeight: 19, fontSize: 13 },
  tagError: { color: Colors.danger, lineHeight: 19, fontSize: 13, fontWeight: "700" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  toggleCopy: { flex: 1, gap: 4 },
  toggleTitle: { color: Colors.ink, fontWeight: "900", fontSize: 16 },
  status: { color: Colors.basil, fontWeight: "700" },
  verified: { color: Colors.basil, fontWeight: "900" },
  unverified: { color: Colors.tomatoDark, fontWeight: "900" },
  section: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  meta: { color: Colors.muted, lineHeight: 20 }
});
