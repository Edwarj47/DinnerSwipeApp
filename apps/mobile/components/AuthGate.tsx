import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "expo-router";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { addAuthChangeListener, apiFetch, clearAuthTokens, getToken, setAuthTokens } from "@/services/api";

type Props = {
  children: ReactNode;
};

const PUBLIC_PATHS = new Set(["/privacy", "/terms"]);

export function AuthGate({ children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    setPendingMode(mode);
    setStatus("");
    try {
      const tokens = await apiFetch<{ access_token: string; refresh_token: string }>(`/api/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ email, password })
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

  if (PUBLIC_PATHS.has(pathname)) return children;

  if (checking) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.tomato} />
      </View>
    );
  }

  if (authenticated) return children;

  const canSubmit = email.trim().length > 3 && password.length >= 8 && pendingMode === null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
      <View style={styles.hero}>
        <BrandLogo size={92} framed />
        <Text style={styles.kicker}>Dinner Swipe</Text>
        <Text style={styles.title}>Plan dinners everyone can vote on.</Text>
        <Text style={styles.subtitle}>Sign in or create an account to save recipes, build your week, and share group picks.</Text>
      </View>
      <View style={styles.panel}>
        <TextInput autoCapitalize="none" accessibilityLabel="Email" value={email} onChangeText={setEmail} placeholder="Email" style={styles.input} />
        <TextInput accessibilityLabel="Password" secureTextEntry value={password} onChangeText={setPassword} placeholder="Password" style={styles.input} />
        <View style={styles.actions}>
          <Button label="Sign in" icon="log-in" variant="primary" disabled={!canSubmit || pendingMode === "login"} onPress={() => void authenticate("login")} />
          <Button label="Create account" icon="person-add" disabled={!canSubmit || pendingMode === "register"} onPress={() => void authenticate("register")} />
        </View>
        <View style={styles.legalLinks}>
          <Button label="Privacy" icon="document-text" onPress={() => router.push("/privacy" as never)} />
          <Button label="Terms" icon="document-text" onPress={() => router.push("/terms" as never)} />
        </View>
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", backgroundColor: Colors.background, padding: 18, gap: 18 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.background },
  hero: { alignItems: "center", gap: 8 },
  kicker: { color: Colors.tomatoDark, fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  title: { color: Colors.ink, fontSize: 31, fontWeight: "900", textAlign: "center", lineHeight: 36 },
  subtitle: { color: Colors.muted, textAlign: "center", lineHeight: 22, maxWidth: 340 },
  panel: { backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, padding: 14, gap: 10 },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 },
  actions: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  legalLinks: { flexDirection: "row", gap: 10, flexWrap: "wrap", paddingTop: 2 },
  status: { color: Colors.danger, fontWeight: "700", lineHeight: 20 }
});
