import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { HouseholdPanel } from "@/features/groups/HouseholdPanel";
import { apiFetch, setToken } from "@/services/api";

export default function ProfileScreen() {
  const [email, setEmail] = useState("test@example.com");
  const [password, setPassword] = useState("change-me-123");
  const [status, setStatus] = useState("");
  const auth = useMutation({
    mutationFn: (mode: "login" | "register") =>
      apiFetch<{ access_token: string }>(`/api/v1/auth/${mode}`, { method: "POST", body: JSON.stringify({ email, password }) }),
    onSuccess: async (data) => {
      await setToken(data.access_token);
      setStatus("Signed in. Seed meals and refresh Discover.");
    },
    onError: (error) => setStatus(String(error))
  });
  return (
    <Screen>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>Household preferences, auth, Walmart ZIP, and notification settings are kept configurable for production setup.</Text>
      <View style={styles.panel}>
        <TextInput autoCapitalize="none" accessibilityLabel="Email" value={email} onChangeText={setEmail} style={styles.input} />
        <TextInput accessibilityLabel="Password" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} />
        <View style={styles.actions}>
          <Button label="Register" icon="person-add" variant="primary" onPress={() => auth.mutate("register")} />
          <Button label="Sign in" icon="log-in" onPress={() => auth.mutate("login")} />
        </View>
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
  status: { color: Colors.basil, fontWeight: "700" },
  section: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  meta: { color: Colors.muted, lineHeight: 20 }
});
