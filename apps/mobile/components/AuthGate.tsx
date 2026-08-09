import { useQueryClient } from "@tanstack/react-query";
import { Link, usePathname } from "expo-router";
import { ReactNode, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { addAuthChangeListener, apiFetch, clearAuthTokens, getToken, setAuthTokens } from "@/services/api";
import {
  BiometricSettings,
  authenticateForUnlock,
  getBiometricSettings,
  setBiometricPreference
} from "@/services/biometrics";

type Props = {
  children: ReactNode;
};

const PUBLIC_PATHS = new Set(["/privacy", "/terms"]);
const LEGAL_DOCUMENT_VERSION = "2026-08-03";
type AuthMode = "choice" | "login" | "register";

export function AuthGate({ children }: Props) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("choice");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [status, setStatus] = useState("");
  const [pendingMode, setPendingMode] = useState<"login" | "register" | null>(null);
  const [biometricSettings, setBiometricSettings] = useState<BiometricSettings | null>(null);
  const [enableBiometricAfterAuth, setEnableBiometricAfterAuth] = useState(false);

  const checkSession = useCallback(async () => {
    if (PUBLIC_PATHS.has(pathname)) {
      setChecking(false);
      return;
    }
    const token = await getToken();
    if (!token) {
      setAuthenticated(false);
      setChecking(false);
      return;
    }
    try {
      await apiFetch("/api/v1/auth/status");
      setAuthenticated(true);
    } catch {
      await clearAuthTokens();
      setAuthenticated(false);
    } finally {
      setChecking(false);
    }
  }, [pathname]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(() => addAuthChangeListener(() => void checkSession()), [checkSession]);

  useEffect(() => {
    void getBiometricSettings().then((settings) => {
      setBiometricSettings(settings);
      if (settings.enabled) setEnableBiometricAfterAuth(true);
    });
  }, []);

  const normalizedEmail = email.trim();
  const isEmailReady = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const isPasswordReady = password.length >= 8;
  const doPasswordsMatch = confirmPassword.length > 0 && confirmPassword === password;
  const canLogin = normalizedEmail.length > 3 && password.length > 0 && pendingMode === null;
  const canRegister = isEmailReady && isPasswordReady && doPasswordsMatch && acceptedLegal && pendingMode === null;
  const canOfferBiometricOptIn =
    Platform.OS !== "web" &&
    Boolean(biometricSettings?.supported) &&
    authMode !== "choice" &&
    !biometricSettings?.enabled;
  const registerRequirements = [
    { label: "Enter a valid email address.", met: isEmailReady },
    { label: "Use at least 8 password characters.", met: isPasswordReady },
    { label: "Confirm that both passwords match.", met: doPasswordsMatch },
    { label: "Accept the Privacy Policy and Terms.", met: acceptedLegal }
  ];

  async function authenticate(mode: "login" | "register") {
    if (mode === "register" && !canRegister) {
      if (!isEmailReady) {
        setStatus("Enter a valid email address before creating an account.");
      } else if (!isPasswordReady) {
        setStatus("Password must be at least 8 characters.");
      } else if (!doPasswordsMatch) {
        setStatus("Passwords must match before creating an account.");
      } else {
        setStatus("Accept the Privacy Policy and Terms of Service before creating an account.");
      }
      return;
    }
    setPendingMode(mode);
    setStatus("");
    try {
      const tokens = await apiFetch<{ access_token: string; refresh_token: string }>(`/api/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          ...(mode === "register"
            ? {
                privacy_accepted: true,
                terms_accepted: true,
                legal_document_version: LEGAL_DOCUMENT_VERSION
              }
            : {})
        })
      });
      await setAuthTokens(tokens);
      if (
        enableBiometricAfterAuth &&
        biometricSettings?.supported &&
        !biometricSettings.enabled
      ) {
        const approved = await authenticateForUnlock(`Enable Dinner Swipe ${biometricSettings.label} unlock`);
        if (approved) {
          await setBiometricPreference(true);
        }
      }
      await queryClient.invalidateQueries();
      setAuthenticated(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to complete authentication.");
    } finally {
      setPendingMode(null);
    }
  }

  if (PUBLIC_PATHS.has(pathname) || authenticated) return children;

  const panelTitle =
    authMode === "login" ? "Welcome back" : authMode === "register" ? "Create account" : "Get started";

  return (
    <>
      {children}
      <SafeAreaView style={styles.overlay}>
        {checking ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <View style={styles.hero}>
                <BrandLogo size={94} framed />
                <Text style={styles.kicker}>Dinner Swipe</Text>
                <Text style={styles.title}>Plan dinners everyone can vote on.</Text>
                <Text style={styles.subtitle}>
                  Save recipes, build your week, and share group picks without the spreadsheet.
                </Text>
              </View>
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>{panelTitle}</Text>
                {authMode === "choice" ? (
                  <View style={styles.actions}>
                    <Button
                      label="Log in"
                      icon="log-in"
                      variant="primary"
                      onPress={() => {
                        setStatus("");
                        setAuthMode("login");
                      }}
                    />
                    <Button
                      label="Create account"
                      icon="person-add"
                      onPress={() => {
                        setStatus("");
                        setAuthMode("register");
                      }}
                    />
                  </View>
                ) : (
                  <>
                    <TextInput
                      autoCapitalize="none"
                      autoComplete="email"
                      accessibilityLabel="Email"
                      keyboardType="email-address"
                      textContentType="username"
                      value={email}
                      onChangeText={setEmail}
                      placeholder="Email"
                      placeholderTextColor="#9b928b"
                      style={styles.input}
                    />
                    <TextInput
                      accessibilityLabel="Password"
                      autoComplete={authMode === "login" ? "password" : "new-password"}
                      secureTextEntry
                      textContentType={authMode === "login" ? "password" : "newPassword"}
                      value={password}
                      onChangeText={setPassword}
                      placeholder={authMode === "login" ? "Password" : "Create password"}
                      placeholderTextColor="#9b928b"
                      style={styles.input}
                    />
                    {authMode === "register" ? (
                      <>
                        <TextInput
                          accessibilityLabel="Confirm password"
                          autoComplete="new-password"
                          secureTextEntry
                          textContentType="newPassword"
                          value={confirmPassword}
                          onChangeText={setConfirmPassword}
                          placeholder="Confirm password"
                          placeholderTextColor="#9b928b"
                          style={styles.input}
                        />
                        <Text style={styles.helperText}>
                          Complete each requirement below to create your account.
                        </Text>
                        <View style={styles.requirements} accessibilityLabel="Account creation requirements">
                          {registerRequirements.map((requirement) => (
                            <View key={requirement.label} style={styles.requirementRow}>
                              <View style={[styles.requirementMark, requirement.met ? styles.requirementMarkMet : null]}>
                                {requirement.met ? <Text style={styles.requirementCheck}>✓</Text> : null}
                              </View>
                              <Text style={[styles.requirementText, requirement.met ? styles.requirementTextMet : null]}>
                                {requirement.label}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </>
                    ) : null}
                    {canOfferBiometricOptIn ? (
                      <View style={styles.biometricRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.biometricTitle}>
                            Use {biometricSettings?.label ?? "biometrics"} on this device
                          </Text>
                          <Text style={styles.biometricText}>
                            After this {authMode === "register" ? "account is created" : "sign-in"},
                            unlock the saved session without typing your password.
                          </Text>
                        </View>
                        <Switch
                          accessibilityLabel="Enable biometric unlock after authentication"
                          value={enableBiometricAfterAuth}
                          onValueChange={setEnableBiometricAfterAuth}
                          thumbColor={enableBiometricAfterAuth ? Colors.tomato : Colors.surface}
                          trackColor={{ false: Colors.border, true: "#f4aaa8" }}
                        />
                      </View>
                    ) : null}
                  </>
                )}
                {authMode === "login" ? (
                  <Button
                    label="Sign in"
                    icon="log-in"
                    variant="primary"
                    disabled={!canLogin || pendingMode === "login"}
                    onPress={() => void authenticate("login")}
                  />
                ) : null}
                {authMode === "register" ? (
                  <>
                    <Button
                      label="Create account"
                      icon="person-add"
                      variant="primary"
                      disabled={!canRegister || pendingMode === "register"}
                      onPress={() => void authenticate("register")}
                    />
                    <Pressable
                      accessibilityLabel="Accept Privacy Policy and Terms of Service"
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: acceptedLegal }}
                      onPress={() => setAcceptedLegal((value) => !value)}
                      style={styles.consentRow}
                    >
                      <View style={[styles.checkbox, acceptedLegal ? styles.checkboxChecked : null]}>
                        {acceptedLegal ? <Text style={styles.checkmark}>✓</Text> : null}
                      </View>
                      <Text style={styles.consentText}>I agree before creating an account.</Text>
                    </Pressable>
                  </>
                ) : null}
                {authMode !== "choice" ? (
                  <Button
                    label={authMode === "login" ? "Create account instead" : "Log in instead"}
                    icon={authMode === "login" ? "person-add" : "log-in"}
                    onPress={() => {
                      setStatus("");
                      setAuthMode(authMode === "login" ? "register" : "login");
                    }}
                  />
                ) : null}
                <View style={styles.legalTextRow}>
                  <Text style={styles.legalText}>Review the </Text>
                  <Link href="/privacy" style={styles.legalLink}>
                    Privacy Policy
                  </Link>
                  <Text style={styles.legalText}> and </Text>
                  <Link href="/terms" style={styles.legalLink}>
                    Terms
                  </Link>
                  <Text style={styles.legalText}>.</Text>
                </View>
                {status ? <Text style={styles.status}>{status}</Text> : null}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.tomato, zIndex: 20 },
  keyboard: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", padding: 20, gap: 20 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.tomato },
  hero: { alignItems: "center", gap: 9 },
  kicker: { color: "#fff", fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  title: { color: "#fff", fontSize: 32, fontWeight: "900", textAlign: "center", lineHeight: 37 },
  subtitle: { color: "#ffe6e3", textAlign: "center", lineHeight: 22, maxWidth: 340 },
  panel: { backgroundColor: Colors.surface, borderColor: "#f7d3cf", borderWidth: 1, borderRadius: 8, padding: 16, gap: 12 },
  panelTitle: { color: Colors.ink, fontSize: 19, fontWeight: "900" },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 },
  actions: { gap: 10 },
  consentRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center", backgroundColor: Colors.surface },
  checkboxChecked: { backgroundColor: Colors.tomato, borderColor: Colors.tomato },
  checkmark: { color: "#fff", fontWeight: "900", fontSize: 16, lineHeight: 20 },
  consentText: { color: Colors.ink, fontWeight: "700", flex: 1 },
  legalTextRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  legalText: { color: Colors.muted, lineHeight: 21 },
  legalLink: { color: Colors.tomatoDark, fontWeight: "900", lineHeight: 21 },
  helperText: { color: Colors.muted, lineHeight: 20 },
  requirements: { gap: 7, marginTop: -2, marginBottom: 2 },
  requirementRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  requirementMark: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface
  },
  requirementMarkMet: { backgroundColor: Colors.basil, borderColor: Colors.basil },
  requirementCheck: { color: "#fff", fontWeight: "900", fontSize: 12, lineHeight: 14 },
  requirementText: { color: Colors.muted, flex: 1, lineHeight: 18, fontSize: 13 },
  requirementTextMet: { color: Colors.ink, fontWeight: "700" },
  biometricRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: Colors.softRed
  },
  biometricTitle: { color: Colors.ink, fontWeight: "900" },
  biometricText: { color: Colors.muted, lineHeight: 19, marginTop: 3, fontSize: 13 },
  status: { color: Colors.danger, fontWeight: "700", lineHeight: 20 }
});
