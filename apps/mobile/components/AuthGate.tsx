import { useQueryClient } from "@tanstack/react-query";
import { Link, usePathname } from "expo-router";
import { ReactNode, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { addAuthChangeListener, apiFetch, clearAuthTokens, getToken, setAuthTokens } from "@/services/api";

type Props = {
  children: ReactNode;
};

const PUBLIC_PATHS = new Set(["/privacy", "/terms"]);
const LEGAL_DOCUMENT_VERSION = "2026-08-03";

export function AuthGate({ children }: Props) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [status, setStatus] = useState("");
  const [pendingMode, setPendingMode] = useState<"login" | "register" | null>(null);

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

  async function authenticate(mode: "login" | "register") {
    if (mode === "register" && !acceptedLegal) {
      setStatus("Accept the Privacy Policy and Terms of Service before creating an account.");
      return;
    }
    setPendingMode(mode);
    setStatus("");
    try {
      const tokens = await apiFetch<{ access_token: string; refresh_token: string }>(`/api/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({
          email,
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
      await queryClient.invalidateQueries();
      setAuthenticated(true);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setPendingMode(null);
    }
  }

  if (PUBLIC_PATHS.has(pathname) || authenticated) return children;

  const canLogin = email.trim().length > 3 && password.length >= 8 && pendingMode === null;
  const canRegister = canLogin && acceptedLegal;

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
                <Text style={styles.panelTitle}>Welcome back</Text>
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
                  autoComplete="password"
                  secureTextEntry
                  textContentType="password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor="#9b928b"
                  style={styles.input}
                />
                <View style={styles.actions}>
                  <Button
                    label="Sign in"
                    icon="log-in"
                    variant="primary"
                    disabled={!canLogin || pendingMode === "login"}
                    onPress={() => void authenticate("login")}
                  />
                  <Button
                    label="Create account"
                    icon="person-add"
                    disabled={!canRegister || pendingMode === "register"}
                    onPress={() => void authenticate("register")}
                  />
                </View>
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
  status: { color: Colors.danger, fontWeight: "700", lineHeight: 20 }
});
