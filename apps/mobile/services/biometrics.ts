import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const BIOMETRIC_ENABLED_KEY = "dinnerSwipeBiometricUnlockEnabled";

export type BiometricSettings = {
  enabled: boolean;
  supported: boolean;
  hasHardware: boolean;
  enrolled: boolean;
  label: string;
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

function labelForTypes(types: LocalAuthentication.AuthenticationType[]) {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "Face ID";
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "fingerprint";
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return "biometric";
  return "device unlock";
}

export async function getBiometricSettings(): Promise<BiometricSettings> {
  const enabled = await readEnabledPreference();
  if (Platform.OS === "web") {
    return { enabled: false, supported: false, hasHardware: false, enrolled: false, label: "biometric" };
  }
  const [hasHardware, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync()
  ]);
  return {
    enabled,
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
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: "Cancel",
    fallbackLabel: "Use device passcode",
    disableDeviceFallback: false
  });
  return result.success;
}
