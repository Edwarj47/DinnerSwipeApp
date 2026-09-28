import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const BIOMETRIC_ENABLED_KEY = "dinnerSwipeBiometricUnlockEnabled";
const BIOMETRIC_TIMEOUT_KEY = "dinnerSwipeBiometricTimeoutMinutes";
export const BIOMETRIC_TIMEOUT_OPTIONS = [0, 1, 5, 15] as const;
export type BiometricTimeout = typeof BIOMETRIC_TIMEOUT_OPTIONS[number];
let promptActive = false;

export function isBiometricPromptActive() { return promptActive; }

export type BiometricSettings = {
  enabled: boolean;
  supported: boolean;
  hasHardware: boolean;
  enrolled: boolean;
  label: string;
  timeoutMinutes: BiometricTimeout;
};

function webStorage() {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  return window.localStorage;
}

async function readEnabledPreference() {
  if (Platform.OS === "web") {
    return webStorage()?.getItem(BIOMETRIC_ENABLED_KEY) === "true";
  }
  return (await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY)) === "true";
}

export async function setBiometricPreference(enabled: boolean) {
  if (Platform.OS === "web") {
    webStorage()?.setItem(BIOMETRIC_ENABLED_KEY, enabled ? "true" : "false");
    return;
  }
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, enabled ? "true" : "false");
}

export async function setBiometricTimeout(minutes: BiometricTimeout) {
  if (!BIOMETRIC_TIMEOUT_OPTIONS.includes(minutes)) throw new Error("Invalid lock timeout.");
  if (Platform.OS === "web") webStorage()?.setItem(BIOMETRIC_TIMEOUT_KEY, String(minutes));
  else await SecureStore.setItemAsync(BIOMETRIC_TIMEOUT_KEY, String(minutes));
}

async function readTimeout(): Promise<BiometricTimeout> {
  const stored = Platform.OS === "web" ? webStorage()?.getItem(BIOMETRIC_TIMEOUT_KEY) : await SecureStore.getItemAsync(BIOMETRIC_TIMEOUT_KEY);
  const value = stored == null ? 5 : Number(stored);
  return BIOMETRIC_TIMEOUT_OPTIONS.includes(value as BiometricTimeout) ? value as BiometricTimeout : 5;
}

function labelForTypes(types: LocalAuthentication.AuthenticationType[]) {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "Face ID";
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "fingerprint";
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return "biometric";
  return "device unlock";
}

export async function getBiometricSettings(): Promise<BiometricSettings> {
  const [enabled, timeoutMinutes] = await Promise.all([readEnabledPreference(), readTimeout()]);
  if (Platform.OS === "web") {
    return { enabled: false, supported: false, hasHardware: false, enrolled: false, label: "biometric", timeoutMinutes };
  }
  const [hasHardware, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync()
  ]);
  return {
    enabled,
    timeoutMinutes,
    supported: hasHardware && enrolled,
    hasHardware,
    enrolled,
    label: labelForTypes(types)
  };
}

export async function authenticateForUnlock(promptMessage = "Unlock Dinner Swipe") {
  if (Platform.OS === "web") return false;
  const settings = await getBiometricSettings();
  if (!settings.supported) return false;
  if (promptActive) return false;
  promptActive = true;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: "Cancel",
      fallbackLabel: "Use device passcode",
      disableDeviceFallback: false
    });
    return result.success;
  } finally { promptActive = false; }
}
