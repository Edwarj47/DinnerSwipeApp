/* eslint-disable import/first */

const mockSecureStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore.set(key, value);
    return Promise.resolve();
  }),
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore.get(key) ?? null)),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStore.delete(key);
    return Promise.resolve();
  })
}));

import { apiFetch, clearAuthTokens, getRefreshToken, getToken, setAuthTokens } from "@/services/api";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  } as Response;
}

beforeEach(() => {
  mockSecureStore.clear();
  global.fetch = jest.fn();
});

test("stores and clears access and refresh tokens", async () => {
  await setAuthTokens({ access_token: "access-a", refresh_token: "refresh-a" });
  expect(await getToken()).toBe("access-a");
  expect(await getRefreshToken()).toBe("refresh-a");

  await clearAuthTokens();
  expect(await getToken()).toBeNull();
  expect(await getRefreshToken()).toBeNull();
});

test("refreshes an expired access token and retries the request once", async () => {
  await setAuthTokens({ access_token: "expired-access", refresh_token: "refresh-a" });
  const fetchMock = jest.mocked(fetch);
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
    .mockResolvedValueOnce(jsonResponse({ access_token: "new-access", refresh_token: "new-refresh" }))
    .mockResolvedValueOnce(jsonResponse({ household_size: 2 }));

  const data = await apiFetch<{ household_size: number }>("/api/v1/profile");

  expect(data.household_size).toBe(2);
  expect(await getToken()).toBe("new-access");
  expect(await getRefreshToken()).toBe("new-refresh");
  const retryHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Headers;
  expect(retryHeaders.get("Authorization")).toBe("Bearer new-access");
});

test("shares one refresh request across concurrent expired requests", async () => {
  await setAuthTokens({ access_token: "expired-access", refresh_token: "refresh-a" });
  const fetchMock = jest.mocked(fetch);
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ detail: "expired-a" }, 401))
    .mockResolvedValueOnce(jsonResponse({ detail: "expired-b" }, 401))
    .mockResolvedValueOnce(jsonResponse({ access_token: "new-access", refresh_token: "new-refresh" }))
    .mockResolvedValueOnce(jsonResponse({ household_size: 2 }))
    .mockResolvedValueOnce(jsonResponse({ weekly_meal_target: 5 }));

  const [profile, settings] = await Promise.all([
    apiFetch<{ household_size: number }>("/api/v1/profile"),
    apiFetch<{ weekly_meal_target: number }>("/api/v1/profile/settings")
  ]);

  expect(profile.household_size).toBe(2);
  expect(settings.weekly_meal_target).toBe(5);
  expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("/api/v1/auth/refresh"))).toHaveLength(1);
  expect(await getToken()).toBe("new-access");
  expect(await getRefreshToken()).toBe("new-refresh");
});

test("formats API errors for user-facing auth messages", async () => {
  const fetchMock = jest.mocked(fetch);
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ detail: "Invalid email or password" }, 401))
    .mockResolvedValueOnce(
      jsonResponse(
        {
          detail: [
            {
              loc: ["body", "password"],
              msg: "String should have at least 8 characters",
              type: "string_too_short"
            }
          ]
        },
        422
      )
    );

  await expect(apiFetch("/api/v1/auth/login")).rejects.toThrow("Invalid email or password");
  await expect(apiFetch("/api/v1/auth/register")).rejects.toThrow(
    "Password must be at least 8 characters."
  );
});
