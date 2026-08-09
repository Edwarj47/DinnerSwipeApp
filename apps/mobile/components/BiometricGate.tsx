import { useQueryClient } from "@tanstack/react-query";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, AppStateStatus, StyleSheet, Text, View } from "react-native";

import { BiometricSettings, authenticateForUnlock, getBiometricSettings, setBiometricPreference } from "@/services/biometrics";
import { clearAuthTokens, getRefreshToken, getToken } from "@/services/api";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";

type Props = {
  children: ReactNode;
};

type GateState = "checking" | "locked" | "unlocked";

export function BiometricGate({ children }: Props) {
  const queryClient = useQueryClient();
  const [gateState, setGateState] = useState<GateState>("checking");
  const [settings, setSettings] = useState<BiometricSettings | null>(null);
  const [message, setMessage] = useState("");
  const lastAppState = useRef<AppStateStatus>(AppState.currentState);
  const promptInProgress = useRef(false);

  const lockIfNeeded = useCallback(async () => {
    const [token, refreshToken, biometricSettings] = await Promise.all([
      getToken(),
      getRefreshToken(),
      getBiometricSettings()
    ]);
    setSettings(biometricSettings);
    if ((token || refreshToken) && biometricSettings.enabled && biometricSettings.supported) {
      setGateState("locked");
      return;
    }
    setGateState("unlocked");
  }, []);

  useEffect(() => {
    void lockIfNeeded();
  }, [lockIfNeeded]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = lastAppState.current;
      lastAppState.current = nextState;
      if ((previousState === "inactive" || previousState === "background") && nextState === "active") {
        void lockIfNeeded();
      }
    });
    return () => subscription.remove();
  }, [lockIfNeeded]);

  const unlock = useCallback(async () => {
    if (promptInProgress.current) return;
    promptInProgress.current = true;
    setMessage("");
    try {
      const unlocked = await authenticateForUnlock();
      if (unlocked) {
        setGateState("unlocked");
        return;
      }
      setMessage("Unlock was cancelled or not recognized.");
    } finally {
      promptInProgress.current = false;
    }
  }, []);

  useEffect(() => {
    if (gateState === "locked") {
      void unlock();
    }
  }, [gateState, unlock]);

  async function usePasswordInstead() {
    await Promise.all([clearAuthTokens(), setBiometricPreference(false)]);
    queryClient.clear();
    setGateState("unlocked");
  }

  if (gateState === "checking") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.tomato} />
      </View>
    );
  }

  if (gateState === "locked") {
    return (
      <View style={styles.lockScreen}>
        <BrandLogo size={88} framed />
        <View style={styles.copy}>
          <Text style={styles.title}>Dinner Swipe</Text>
          <Text style={styles.subtitle}>Unlock your saved session with {settings?.label ?? "biometric"} authentication.</Text>
        </View>
        <View style={styles.actions}>
          <Button label="Unlock" icon="finger-print" variant="primary" onPress={unlock} accessibilityLabel="Unlock Dinner Swipe with biometrics" />
          <Button label="Use password" icon="key" onPress={usePasswordInstead} accessibilityLabel="Clear saved session and sign in with password" />
        </View>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    );
  }

  return children;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.background },
  lockScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background,
    padding: 24,
    gap: 22
  },
  copy: { alignItems: "center", gap: 8, maxWidth: 320 },
  title: { color: Colors.ink, fontSize: 32, fontWeight: "900" },
  subtitle: { color: Colors.muted, textAlign: "center", lineHeight: 22 },
  actions: { width: "100%", maxWidth: 320, gap: 10 },
  message: { color: Colors.tomatoDark, fontWeight: "700", textAlign: "center" }
});
