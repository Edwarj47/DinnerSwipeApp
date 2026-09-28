import { apiFetch } from "@/services/api";
import { saveProfilePreferences, shouldConfirmPlanReset } from "@/services/profilePreferences";
import { UserProfile } from "@/services/types";

jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
const current = { email: "fixture@example.com", household_size: 3, weekly_meal_target: 7,
  allergens: ["peanuts"], preferred_grocery_retailer: "kroger",
  notification_preferences: { meal_reminders: true, confirm_plan_reset: false }, tutorial_completed_at: "fixture-date"
} as unknown as UserProfile;

beforeEach(() => jest.mocked(apiFetch).mockReset());

test("missing or malformed reset preference requires confirmation", () => {
  expect(shouldConfirmPlanReset()).toBe(true);
  expect(shouldConfirmPlanReset({ ...current, notification_preferences: {} })).toBe(true);
  expect(shouldConfirmPlanReset({ ...current, notification_preferences: { confirm_plan_reset: "false" } })).toBe(true);
  expect(shouldConfirmPlanReset(current)).toBe(false);
});

test("saving reset preference keeps latest meal preferences and other notifications", async () => {
  jest.mocked(apiFetch).mockResolvedValueOnce(current).mockResolvedValueOnce(current);
  await saveProfilePreferences({ notification_preferences: { confirm_plan_reset: true } });
  const payload = JSON.parse(String(jest.mocked(apiFetch).mock.calls[1][1]?.body));
  expect(payload).toMatchObject({ household_size: 3, weekly_meal_target: 7, allergens: ["peanuts"],
    preferred_grocery_retailer: "kroger", notification_preferences: { meal_reminders: true, confirm_plan_reset: true } });
  expect(payload.email).toBeUndefined();
  expect(payload.tutorial_completed_at).toBeUndefined();
});

test("saving meal preferences keeps the persisted reset setting", async () => {
  jest.mocked(apiFetch).mockResolvedValueOnce(current).mockResolvedValueOnce(current);
  await saveProfilePreferences({ household_size: 4 });
  expect(JSON.parse(String(jest.mocked(apiFetch).mock.calls[1][1]?.body))).toMatchObject({
    household_size: 4, notification_preferences: { confirm_plan_reset: false }
  });
});

test("failed profile read cannot overwrite settings with defaults", async () => {
  jest.mocked(apiFetch).mockRejectedValue(new Error("Offline"));
  await expect(saveProfilePreferences({ household_size: 4 })).rejects.toThrow("Offline");
  expect(apiFetch).toHaveBeenCalledTimes(1);
});
