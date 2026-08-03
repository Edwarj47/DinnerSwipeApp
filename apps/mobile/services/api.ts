import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "web" && typeof window !== "undefined"
    ? window.location.origin
    : "http://127.0.0.1:8108");
const WEB_TOKEN_KEY = "dinnerSwipeAccessToken";

export async function setToken(token: string) {
  if (Platform.OS === "web") {
    localStorage.setItem(WEB_TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(WEB_TOKEN_KEY, token);
  }
}

export async function getToken() {
  if (Platform.OS === "web") {
    return localStorage.getItem(WEB_TOKEN_KEY);
  }
  return SecureStore.getItemAsync(WEB_TOKEN_KEY);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}
