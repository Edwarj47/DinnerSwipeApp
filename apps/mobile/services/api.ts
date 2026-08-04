import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "web" && typeof window !== "undefined"
    ? window.location.origin
    : "http://127.0.0.1:8108");
const ACCESS_TOKEN_KEY = "dinnerSwipeAccessToken";
const REFRESH_TOKEN_KEY = "dinnerSwipeRefreshToken";

export type AuthTokenPair = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
};

function webStorage() {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  return window.localStorage;
}

async function setStorageItem(key: string, value: string) {
  if (Platform.OS === "web") {
    webStorage()?.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

async function getStorageItem(key: string) {
  if (Platform.OS === "web") {
    return webStorage()?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function deleteStorageItem(key: string) {
  if (Platform.OS === "web") {
    webStorage()?.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

export async function setAuthTokens(tokens: AuthTokenPair) {
  await setStorageItem(ACCESS_TOKEN_KEY, tokens.access_token);
  if (tokens.refresh_token) {
    await setStorageItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  }
}

export async function setToken(token: string) {
  await setStorageItem(ACCESS_TOKEN_KEY, token);
}

export async function getToken() {
  return getStorageItem(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken() {
  return getStorageItem(REFRESH_TOKEN_KEY);
}

export async function clearAuthTokens() {
  await Promise.all([deleteStorageItem(ACCESS_TOKEN_KEY), deleteStorageItem(REFRESH_TOKEN_KEY)]);
}

export async function refreshAuthTokens() {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;
  const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!response.ok) {
    await clearAuthTokens();
    return false;
  }
  await setAuthTokens((await response.json()) as AuthTokenPair);
  return true;
}

function shouldSetJsonContentType(init: RequestInit) {
  if (!init.body) return true;
  if (typeof FormData !== "undefined" && init.body instanceof FormData) return false;
  return true;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return authorizedFetch<T>(path, init, true);
}

async function authorizedFetch<T>(path: string, init: RequestInit, canRefresh: boolean): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && shouldSetJsonContentType(init)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (response.status === 401 && canRefresh && path !== "/api/v1/auth/refresh" && path !== "/api/v1/auth/login" && path !== "/api/v1/auth/register") {
    const refreshed = await refreshAuthTokens();
    if (refreshed) return authorizedFetch<T>(path, init, false);
  }
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}
