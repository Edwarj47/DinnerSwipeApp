import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { AppVersion } from "@/components/AppVersion";
import { useTransientMessage } from "@/components/useTransientMessage";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { SubscriptionPanel } from "@/features/subscription/SubscriptionPanel";
import { apiFetch, clearAuthTokens, getRefreshToken, getToken, setAuthTokens } from "@/services/api";
import { BiometricSettings, BiometricTimeout, authenticateForUnlock, getBiometricSettings, setBiometricPreference, setBiometricTimeout } from "@/services/biometrics";
import { saveProfilePreferences, shouldConfirmPlanReset } from "@/services/profilePreferences";
import { openTutorial } from "@/services/tutorial";
import { UserProfile } from "@/services/types";
import { TourTarget } from "@/features/onboarding/TourTarget";
import { MeasurementSettings } from "@/features/preferences/MeasurementSettings";
import { WeeklyPlanningSettings } from "@/features/preferences/WeeklyPlanningSettings";

import { SettingsSection } from "./SettingsSection";

type UserSection = "account" | "meals";
type AccountAction = "overview" | "reset" | "data" | "delete";
type GroceryRetailer = UserProfile["preferred_grocery_retailer"];

const GROCERY_RETAILER_OPTIONS: { label: string; value: GroceryRetailer }[] = [
  { label: "Walmart", value: "walmart" },
  { label: "Publix", value: "publix" },
  { label: "Kroger", value: "kroger" },
  { label: "Instacart", value: "instacart" }
];

export function UserSettingsPanel({ initialSection, initialFocus, initialResetToken, onExit }: { initialSection?: UserSection; initialFocus?: "subscription" | "planning"; initialResetToken?: string; onExit?: () => void }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [section, setSection] = useState<UserSection | null>(initialSection ?? null);
  const [accountAction, setAccountAction] = useState<AccountAction>("overview");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [householdSize, setHouseholdSize] = useState("2");
  const [maxCookMinutes, setMaxCookMinutes] = useState("");
  const [allergens, setAllergens] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);
  const [preferredRetailer, setPreferredRetailer] = useState<GroceryRetailer>("walmart");
  const [status, setStatus] = useTransientMessage();
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [biometricSettings, setBiometricSettings] = useState<BiometricSettings | null>(null);
  const [biometricBusy, setBiometricBusy] = useState(false);
  useEffect(() => {
    if (initialResetToken) {
      setResetToken(String(initialResetToken));
      setSection("account");
      setAccountAction("reset");
    }
  }, [initialResetToken]);
  useEffect(() => { if (initialSection) setSection(initialSection); }, [initialSection]);
  const refreshBiometricSettings = useCallback(async () => {
    setBiometricSettings(await getBiometricSettings());
  }, []);
  useEffect(() => {
    void refreshBiometricSettings().catch(() => setStatus("Unable to read device security settings."));
  }, [refreshBiometricSettings, setStatus]);
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
    setDisplayName(profile.data.display_name ?? "");
    setHouseholdSize(String(profile.data.household_size));
    setMaxCookMinutes(profile.data.max_cook_minutes ? String(profile.data.max_cook_minutes) : "");
    setAllergens(profile.data.allergens);
    setDislikes(profile.data.disliked_ingredients);
    setPreferredRetailer(profile.data.preferred_grocery_retailer ?? "walmart");
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
      saveProfilePreferences({
          household_size: Number(householdSize) || 2,
          max_cook_minutes: maxCookMinutes ? Number(maxCookMinutes) : null,
          allergens: cleanList(allergens),
          disliked_ingredients: cleanList(dislikes),
          preferred_grocery_retailer: preferredRetailer
      }),
    onSuccess: async () => {
      setStatus("Preferences saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profile"] }),
        queryClient.invalidateQueries({ queryKey: ["grocery"] }),
        queryClient.invalidateQueries({ queryKey: ["recipes"] }),
        queryClient.invalidateQueries({ queryKey: ["weekly-plan"] })
      ]);
    },
    onError: (error) => setStatus(String(error))
  });
  const resetPreference = useMutation({
    mutationFn: (enabled: boolean) => saveProfilePreferences({ notification_preferences: { confirm_plan_reset: enabled } }),
    onSuccess: (data) => {
      queryClient.setQueryData(["profile"], data);
      setStatus("Reset preference saved.");
    },
    onError: () => setStatus("Couldn't save reset preference. Try again.")
  });
  const saveIdentity = useMutation({
    mutationFn: () => apiFetch<UserProfile>("/api/v1/profile/identity", { method: "PATCH", body: JSON.stringify({ display_name: displayName.trim() }) }),
    onSuccess: async data => {
      queryClient.setQueryData(["profile"], data);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["household"] }), queryClient.invalidateQueries({ queryKey: ["households"] })]);
      setStatus("Name saved.");
    },
    onError: () => setStatus("Couldn't save your name. Try again.")
  });
  async function updateBiometricSetting(action: () => Promise<void>) {
    if (biometricBusy) return;
    setBiometricBusy(true);
    try { await action(); }
    catch { setStatus("Couldn't save device security settings. Try again."); }
    finally { setBiometricBusy(false); }
  }
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
    <View style={styles.content}>
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <SettingsSection title="Account" icon="person-outline" expanded={section === "account"} onToggle={() => setSection(section === "account" ? null : "account")}>
          <SettingsSection title="Subscription" icon="card-outline" initiallyOpen={initialFocus === "subscription"}><SubscriptionPanel /></SettingsSection>
          <SettingsSection title="Account details" icon="person-circle-outline" initiallyOpen={!initialFocus}>
          <View style={styles.panel}>
            {authStatus.data ? (
              <View style={styles.securityBox}>
                <Text style={styles.meta}>{authStatus.data.email}</Text>
                <Text style={styles.inputLabel}>Display name (optional)</Text>
                <TextInput accessibilityLabel="Display name" maxLength={100} autoComplete="name" value={displayName} onChangeText={setDisplayName} style={styles.input} />
                <Button label="Save name" icon="save" disabled={!profile.data || saveIdentity.isPending || displayName.trim() === (profile.data.display_name ?? "")} onPress={() => saveIdentity.mutate()} />
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
            <View style={styles.divider} />
            {accountAction !== "overview" ? <View style={styles.sectionHeader}>
              <Button label="Back" icon="arrow-back" variant="quiet" onPress={() => {
                setDeletePassword("");
                setDeleteConfirmation("");
                setAccountAction(accountAction === "delete" ? "data" : "overview");
              }} />
            </View> : null}
            {accountAction === "overview" ? (
              <View style={styles.toolGrid}>
                <Button label="Reset password" icon="mail-open" onPress={() => setAccountAction("reset")} />
                <Button label="Data and legal" icon="document-text" onPress={() => setAccountAction("data")} />
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
                  <Button label="Privacy" icon="document-text" onPress={() => { onExit?.(); router.push("/privacy" as never); }} />
                  <Button label="Terms" icon="document-text" onPress={() => { onExit?.(); router.push("/terms" as never); }} />
                </View>
                <Button label="Delete account" icon="chevron-forward" onPress={() => setAccountAction("delete")} />
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
          </SettingsSection>
          <TourTarget id="account"><SettingsSection title="Planning" icon="calendar-outline" initiallyOpen={initialFocus === "planning"}>
            <View style={styles.toggleRow}>
              <Text style={[styles.toggleTitle, styles.toggleCopy]}>Confirm day and week resets</Text>
              <Switch
                accessibilityLabel="Confirm day and week resets"
                value={shouldConfirmPlanReset(profile.data)}
                disabled={!profile.data || profile.isError || resetPreference.isPending || saveProfile.isPending}
                onValueChange={(value) => resetPreference.mutate(value)}
                thumbColor={shouldConfirmPlanReset(profile.data) ? Colors.tomato : Colors.surface}
                trackColor={{ false: Colors.border, true: "#f4aaa8" }}
              />
            </View>
            <View style={styles.divider} />
            <WeeklyPlanningSettings />
          </SettingsSection></TourTarget>
          <SettingsSection title="Measurements" icon="scale-outline"><MeasurementSettings /></SettingsSection>
          <SettingsSection title="Device security" icon="shield-checkmark-outline">
            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <Text style={styles.toggleTitle}>Enable Biometrics</Text>
              </View>
              <Switch
                accessibilityLabel="Enable Biometrics"
                value={Boolean(biometricSettings?.enabled)}
                disabled={Platform.OS === "web" || biometricBusy || !biometricSettings}
                onValueChange={(value) => {
                  void updateBiometricSetting(() => toggleBiometrics(value));
                }}
                thumbColor={biometricSettings?.enabled ? Colors.tomato : Colors.surface}
                trackColor={{ false: Colors.border, true: "#f4aaa8" }}
              />
            </View>
            {biometricSettings?.enabled ? (
              <View style={styles.retailerPicker}>
                <Text style={styles.inputLabel}>Lock after leaving the app</Text>
                <View style={styles.timeoutOptions}>
                  {([0, 1, 5, 15] as BiometricTimeout[]).map(minutes => (
                    <Pressable key={minutes} accessibilityRole="radio" accessibilityLabel={minutes === 0 ? "Lock immediately" : `Lock after ${minutes} minutes`}
                      accessibilityState={{ checked: biometricSettings.timeoutMinutes === minutes, disabled: biometricBusy }} disabled={biometricBusy}
                      style={[styles.timeoutOption, biometricSettings.timeoutMinutes === minutes && styles.timeoutSelected]}
                      onPress={() => { void updateBiometricSetting(async () => {
                        await setBiometricTimeout(minutes);
                        await refreshBiometricSettings();
                        setStatus("Lock timeout saved.");
                      }); }}>
                      <Text style={biometricSettings.timeoutMinutes === minutes ? styles.timeoutSelectedText : styles.meta}>{minutes === 0 ? "Immediately" : `${minutes} min`}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </SettingsSection>
          <AppVersion />
      </SettingsSection>
      <SettingsSection title="Meals" icon="restaurant-outline" expanded={section === "meals"} onToggle={() => setSection(section === "meals" ? null : "meals")}>
        <TourTarget id="preferences"><View style={styles.panel}>
          <Text style={styles.section}>Food and shopping</Text>
          <Text style={styles.inputLabel}>Default servings</Text>
          <TextInput accessibilityLabel="Default servings" value={householdSize} onChangeText={setHouseholdSize} keyboardType="number-pad" placeholder="2" style={styles.input} />
          <Text style={styles.inputLabel}>Maximum cook time (minutes)</Text>
          <TextInput accessibilityLabel="Maximum preferred cook time" value={maxCookMinutes} onChangeText={setMaxCookMinutes} keyboardType="number-pad" placeholder="No limit" style={styles.input} />
          <View style={styles.retailerPicker}>
            <Text style={styles.inputLabel}>Preferred grocery</Text>
            <SegmentedControl
              adaptive
              accessibilityLabel="Preferred grocery retailer"
              value={preferredRetailer}
              onChange={setPreferredRetailer}
              options={GROCERY_RETAILER_OPTIONS}
            />
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
          <Button label="Save preferences" icon="save" variant="primary" disabled={!profile.data || saveProfile.isPending || resetPreference.isPending} onPress={() => saveProfile.mutate()} />
        </View></TourTarget>
      </SettingsSection>
    </View>
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
  content: { gap: 4 },
  title: { fontSize: 28, fontWeight: "900", color: Colors.ink, marginBottom: 8 },
  panel: { borderTopColor: Colors.border, borderTopWidth: 1, paddingTop: 12, gap: 10, marginTop: 12 },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 },
  timeoutOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeoutOption: { flexGrow: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  timeoutSelected: { borderColor: Colors.tomato, backgroundColor: Colors.softRed },
  timeoutSelectedText: { color: Colors.tomato, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  sectionHeader: { flexDirection: "row", gap: 8, alignItems: "center" },
  toolGrid: { gap: 8 },
  flowBox: { gap: 12 },
  flowTitle: { color: Colors.ink, fontWeight: "900", fontSize: 16 },
  securityBox: { gap: 8 },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
  deleteBox: { borderWidth: 1, borderColor: "#f0b6b2", backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, gap: 9 },
  deleteTitle: { color: Colors.danger, fontWeight: "900" },
  retailerPicker: { gap: 8 },
  tagEditor: { gap: 8 },
  inputLabel: { color: Colors.ink, fontWeight: "900" },
  tagInputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tagInput: { flex: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
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
  toggleRow: { flexDirection: "row", minHeight: 44, alignItems: "center", justifyContent: "space-between", gap: 12 },
  toggleCopy: { flex: 1, gap: 4 },
  toggleTitle: { color: Colors.ink, fontWeight: "900", fontSize: 16 },
  status: { color: Colors.basil, fontWeight: "700" },
  verified: { color: Colors.basil, fontWeight: "900" },
  unverified: { color: Colors.tomatoDark, fontWeight: "900" },
  section: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  meta: { color: Colors.muted, lineHeight: 20 }
});
