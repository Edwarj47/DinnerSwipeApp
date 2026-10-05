import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { MeasurementSettings } from "@/features/preferences/MeasurementSettings";
import { NutritionFields } from "@/features/recipes/NutritionFields";
import { EMPTY_NUTRITION, NutritionInputs, parseNutrition } from "@/features/recipes/recipeNutrition";
import { apiFetch, reconnectOffline } from "@/services/api";
import { deviceOffline } from "@/services/offlineStore";
import { measurementUnits } from "@/services/measurementPreferences";
import { convertWeight, GRAMS_PER_OUNCE, gramTextInUnit, ingredientWeightNote, unitTextInGrams } from "@/services/weightUnits";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn(), reconnectOffline: jest.fn() }));
jest.mock("@/services/offlineStore", () => ({ deviceOffline: jest.fn(() => false) }));
const request = jest.mocked(apiFetch);
let profile: { household_size: number; allergens: string[]; notification_preferences: Record<string, unknown> };
beforeEach(() => {
  jest.mocked(deviceOffline).mockReturnValue(false);
  jest.mocked(reconnectOffline).mockReset().mockResolvedValue(undefined);
  profile = { household_size: 2, allergens: ["peanuts"], notification_preferences: { confirm_plan_reset: false, macro_summary_days: 21 } };
  request.mockReset().mockImplementation(async (path, init) => {
    if (path === "/api/v1/profile") {
      if (init?.method === "PUT") profile = JSON.parse(String(init.body));
      return { ...profile };
    }
    return {};
  });
});
function mount(child: React.ReactNode, preferences: Record<string, unknown> = {}, seeded = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  if (seeded) client.setQueryData(["profile"], { ...profile, notification_preferences: { ...profile.notification_preferences, ...preferences } });
  const screen = render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);
  return { ...screen, client, close: () => { screen.unmount(); client.clear(); } };
}

test("weight conversions use mass only and preserve fractional amounts", () => {
  expect(convertWeight(GRAMS_PER_OUNCE, "grams", "oz")).toBe(1);
  expect(convertWeight(1, "ounces", "g")).toBe(GRAMS_PER_OUNCE);
  expect(convertWeight(1, "kg", "oz")).toBeCloseTo(35.27396, 5);
  expect(convertWeight(1, "lb", "oz")).toBe(16);
  expect(convertWeight(0, "g", "oz")).toBe(0);
  for (const unit of ["cup", "ml", "fluid oz", "fl oz", "each", "constructor", "__proto__", null]) expect(convertWeight(10, unit, "oz")).toBeNull();
  expect(convertWeight(NaN, "g", "oz")).toBeNull();
  expect(gramTextInUnit("", "oz")).toBe("");
  expect(unitTextInGrams(".", "oz")).toBe(".");
  expect(unitTextInGrams("-", "oz")).toBe("-");
});

test("ingredient equivalents require a known weight and leave original wording alone", () => {
  expect(ingredientWeightNote(100, "grams", "oz")).toBe("3.527 oz");
  expect(ingredientWeightNote(1, "lb", "g")).toBe("453.59 g");
  expect(ingredientWeightNote(100, "g", "g")).toBeNull();
  expect(ingredientWeightNote(null, "g", "oz")).toBeNull();
  expect(ingredientWeightNote(1, "cup", "oz")).toBeNull();
});

test("each nutrient uses its own saved unit and invalid preferences default to grams", () => {
  expect(measurementUnits({ notification_preferences: { protein_unit: "oz", carbs_unit: "g", fat_unit: "cups", fiber_unit: null, ingredient_weight_unit: "oz" } }))
    .toEqual({ protein_g: "oz", carbs_g: "g", fat_g: "g", fiber_g: "g", ingredient_weight: "oz" });
  const screen = mount(<NutritionFields value={{ ...EMPTY_NUTRITION, calories: "160", protein_g: "30", carbs_g: "10", fat_g: "0" }} onChange={jest.fn()} />,
    { protein_unit: "oz", fiber_unit: "oz" });
  try {
    expect(screen.getByLabelText("Protein (oz)").props.value).toBe("1.058219");
    expect(screen.getByLabelText("Carbs (g)").props.value).toBe("10");
    expect(screen.getByLabelText("Fat (g)").props.value).toBe("0");
    expect(screen.getByLabelText("Fiber (oz)").props.value).toBe("");
    expect(screen.getByLabelText("Calories").props.value).toBe("160");
    expect(screen.queryByText("As added")).toBeNull();
    expect(screen.queryByText("Weight units")).toBeNull();
  } finally { screen.close(); }
});

test("preference updates only change display, preserving original nutrition and zero/missing values", () => {
  const original = { ...EMPTY_NUTRITION, calories: "160", protein_g: "30", fat_g: "0" };
  const onChange = jest.fn();
  const screen = mount(<NutritionFields value={original} onChange={onChange} />);
  try {
    for (let i = 0; i < 10; i++) {
      act(() => screen.client.setQueryData(["profile"], { notification_preferences: { protein_unit: "oz" } }));
      act(() => screen.client.setQueryData(["profile"], { notification_preferences: { protein_unit: "g" } }));
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(parseNutrition(original)).toMatchObject({ calories: 160, protein_g: 30, fat_g: 0, fiber_g: null });
    expect(request).not.toHaveBeenCalled();
  } finally { screen.close(); }
});

test("ounce inputs keep partial typing and save grams with whole-recipe normalization", () => {
  let current: NutritionInputs = { ...EMPTY_NUTRITION, calories: "160", fat_g: "0" };
  function Form() {
    const [value, setValue] = useState(current);
    return <NutritionFields value={value} onChange={next => { current = next; setValue(next); }} />;
  }
  const screen = mount(<Form />, { protein_unit: "oz", fiber_unit: "oz" });
  try {
    fireEvent.changeText(screen.getByLabelText("Protein (oz)"), "1.");
    expect(screen.getByLabelText("Protein (oz)").props.value).toBe("1.");
    fireEvent.changeText(screen.getByLabelText("Protein (oz)"), "1.5");
    expect(current.protein_g).toBe(String(1.5 * GRAMS_PER_OUNCE));
    expect(parseNutrition(current).protein_g).toBe(42.52);
    expect(parseNutrition(current, 2).protein_g).toBe(21.26);
    expect(current.calories).toBe("160");
    expect(current.fat_g).toBe("0");
    fireEvent.changeText(screen.getByLabelText("Fiber (oz)"), ".");
    expect(() => parseNutrition(current)).toThrow();
  } finally { screen.close(); }
});

test("account settings persist independent choices and preserve unrelated profile preferences", async () => {
  const screen = mount(<MeasurementSettings />, {}, false);
  try {
    await waitFor(() => expect(screen.getByLabelText("Protein in ounces").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Protein in ounces"));
    await waitFor(() => expect(screen.getByLabelText("Protein in ounces").props.accessibilityState.selected).toBe(true));
    fireEvent.press(screen.getByLabelText("Ingredient weights in ounces"));
    await waitFor(() => expect(screen.getByLabelText("Ingredient weights in ounces").props.accessibilityState.selected).toBe(true));
    expect(screen.getByLabelText("Carbs in grams").props.accessibilityState.selected).toBe(true);
    expect(profile.notification_preferences).toEqual({ confirm_plan_reset: false, macro_summary_days: 21, protein_unit: "oz", ingredient_weight_unit: "oz" });
    expect(profile.allergens).toEqual(["peanuts"]);
    expect(screen.queryByText("As added")).toBeNull();
  } finally { screen.close(); }
  const again = mount(<><MeasurementSettings /><NutritionFields value={EMPTY_NUTRITION} onChange={jest.fn()} /></>, {}, false);
  try { await again.findByLabelText("Protein (oz)"); }
  finally { again.close(); }
});

test("failed saves retain the last saved units and expose a retryable error", async () => {
  const screen = mount(<MeasurementSettings />, {}, false);
  try {
    await waitFor(() => expect(screen.getByLabelText("Fiber in ounces").props.accessibilityState.disabled).toBe(false));
    request.mockImplementation(async (_, init) => { if (init?.method === "PUT") throw Error("Offline"); return profile; });
    fireEvent.press(screen.getByLabelText("Fiber in ounces"));
    await screen.findByText("Couldn't save measurement units. Try again.");
    expect(screen.getByLabelText("Fiber in grams").props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText("Fiber in ounces").props.accessibilityState.disabled).toBe(false);
    jest.mocked(deviceOffline).mockReturnValue(true);
    request.mockImplementation(async (_, init) => {
      if (init?.method === "PUT") profile = JSON.parse(String(init.body));
      return profile;
    });
    fireEvent.press(screen.getByLabelText("Fiber in ounces"));
    await waitFor(() => expect(screen.getByLabelText("Fiber in ounces").props.accessibilityState.selected).toBe(true));
    expect(reconnectOffline).toHaveBeenCalledTimes(1);
  } finally { screen.close(); }
});
