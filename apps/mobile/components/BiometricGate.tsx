import { useQueryClient } from "@tanstack/react-query";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, AppStateStatus, StyleSheet, Text, View } from "react-native";

import { BiometricSettings, authenticateForUnlock, getBiometricSettings, isBiometricPromptActive } from "@/services/biometrics";
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
  const [appState, setAppState] = useState(AppState.currentState);
  const lastAppState = useRef<AppStateStatus>(AppState.currentState);
  const promptInProgress = useRef(false);
  const autoUnlockAttempted = useRef(false);
  const awaySince = useRef<number | null>(null);
  const promptTransition = useRef(false);
  const gateStateRef = useRef<GateState>("checking");
  const checkVersion = useRef(0);

  const changeState = useCallback((state: GateState) => {
    if (gateStateRef.current !== state) autoUnlockAttempted.current = false;
    gateStateRef.current = state;
    setGateState(state);
  }, []);

  const lockIfNeeded = useCallback(async (awayMilliseconds: number | null = null) => {
    const version = ++checkVersion.current;
    try {
      const [token, refreshToken, biometricSettings] = await Promise.all([
        getToken(), getRefreshToken(), getBiometricSettings()
      ]);
      if (version !== checkVersion.current) return;
      setSettings(biometricSettings);
      if ((token || refreshToken) && biometricSettings.enabled && biometricSettings.supported) {
        // A grace period only applies to an already unlocked, still-running session.
        const inGrace = gateStateRef.current === "unlocked" && awayMilliseconds !== null &&
          awayMilliseconds >= 0 && awayMilliseconds < biometricSettings.timeoutMinutes * 60_000;
        if (!inGrace) changeState("locked");
        return;
      }
      changeState("unlocked");
    } catch {
      if (version !== checkVersion.current) return;
      changeState("locked");
      setMessage("Unable to check device security. Try unlocking again.");
    }
  }, [changeState]);

  useEffect(() => {
    void lockIfNeeded();
    return () => { checkVersion.current += 1; };
  }, [lockIfNeeded]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = lastAppState.current;
      lastAppState.current = nextState;
      setAppState(nextState);
      if (nextState === "inactive" || nextState === "background") {
        awaySince.current ??= Date.now();
        if (isBiometricPromptActive() || promptInProgress.current) promptTransition.current = true;
      }
      if ((previousState === "inactive" || previousState === "background") && nextState === "active") {
        const elapsed = awaySince.current === null ? null : Date.now() - awaySince.current;
        const returningFromPrompt = promptTransition.current;
        awaySince.current = null;
        promptTransition.current = false;
        // Native authentication also emits AppState changes; do not prompt in a loop.
        if (promptInProgress.current || isBiometricPromptActive() ||
          (returningFromPrompt && (previousState === "inactive" || elapsed === null || (elapsed >= 0 && elapsed < 1000)))) return;
        void lockIfNeeded(elapsed);
      }
    });
    return () => subscription.remove();
  }, [lockIfNeeded]);

  const unlock = useCallback(async () => {
    if (promptInProgress.current || AppState.currentState !== "active") return;
    autoUnlockAttempted.current = true;
    checkVersion.current += 1;
    promptInProgress.current = true;
    setMessage("");
    try {
      const unlocked = await authenticateForUnlock();
      if (unlocked && (AppState.currentState as AppStateStatus) !== "background") {
        awaySince.current = null;
        changeState("unlocked");
        return;
      }
      setMessage("Unlock was cancelled or not recognized.");
    } catch {
      setMessage("Unable to unlock. Try again or sign in with your password.");
    } finally {
      promptInProgress.current = false;
    }
  }, [changeState]);

  useEffect(() => {
    if (gateState === "locked" && appState === "active" && !autoUnlockAttempted.current) {
      void unlock();
    }
  }, [gateState, appState, unlock]);

  async function usePasswordInstead() {
    await clearAuthTokens();
    queryClient.clear();
    checkVersion.current += 1;
    awaySince.current = null;
    changeState("unlocked");
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
