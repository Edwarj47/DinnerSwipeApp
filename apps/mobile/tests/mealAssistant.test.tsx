import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { MealAssistant } from "@/features/premium/MealAssistant";
import { MacroCalculator } from "@/features/premium/MacroCalculator";
import { calculationItems, PROVIDER_VIEW_MS } from "@/features/premium/calculator";
import {
  MealDraft,
  MealDraftItem,
  ReviewedFood,
  reviewedRows,
  suggestedPortions,
} from "@/features/premium/mealAssistant";
import { apiFetch } from "@/services/api";
import { useOfflineStatus } from "@/services/offlineStore";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/features/premium/useMealVoice", () => ({
  useMealVoice: () => ({ supported: false, recording: false, audio: null, error: "",
    start: jest.fn(), stop: jest.fn(), clear: jest.fn() }),
}));
jest.mock("@/features/premium/MacroCalculator", () => ({
  MacroCalculator: jest.fn((props: { initialName: string }) => {
    const React = jest.requireActual<typeof import("react")>("react");
    const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return React.createElement(Text, { testID: "meal-calculator-handoff" }, props.initialName);
  }),
}));

const request = jest.mocked(apiFetch);
const calculator = jest.mocked(MacroCalculator);
const NOW = 1_800_000_000_000;
const serving = {
  serving_id: "7", serving_description: "1 egg", measurement_description: "each",
  number_of_units: "1", metric_serving_amount: "50", metric_serving_unit: "g",
  calories: "74", protein: "6.29", carbohydrate: ".38", fat: "4.97", fiber: "0",
};
const mention: MealDraftItem = {
  name: "My eggs", search_term: "eggs", quantity: 2, unit: "each", food_id: "42",
  food_name: "Provider egg name", servings: [serving],
};
const draft: MealDraft = {
  request_id: "00000000-0000-4000-8000-000000000099", status: "ready",
  name: "My breakfast", meal_label: "breakfast", items: [mention],
};

function reviewed(changes: Partial<ReviewedFood> = {}): ReviewedFood {
  return { ...mention, key: "eggs", serving_id: "7", amount: "2",
    expires: NOW + PROVIDER_VIEW_MS, ...changes };
}

let onAppState: (state: AppStateStatus) => void;
beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  useOfflineStatus.setState({ offline: false });
  calculator.mockClear();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => {
    onAppState = callback;
    return { remove: jest.fn() };
  });
  request.mockReset().mockImplementation(async (path, init) => {
    if (path.endsWith("/consent")) return { accepted: true, terms_version: "fatsecret-terms-v1" };
    if (path.includes("/nutrition/ai/drafts") && init?.method === "DELETE") return { discarded: true };
    if (path.endsWith("/nutrition/ai/drafts") && init?.method === "POST") {
      return { ...draft, request_id: JSON.parse(String(init.body)).request_id };
    }
    throw new Error(`Unexpected API call: ${path}`);
  });
});
afterEach(() => jest.restoreAllMocks());

describe("suggestedPortions", () => {
  test.each([
    { quantity: null, unit: null },
    { quantity: null, unit: "g" },
    { quantity: 2, unit: null },
  ])("does not invent an amount from missing quantity or unit: %j", amount => {
    expect(suggestedPortions({ ...mention, ...amount }, serving)).toBeNull();
  });

  test.each([
    [150, "g", 3], [150, "grams", 3], [.15, "kg", 3],
    [1, "oz", 28.349523125 / 50], [1, "lb", 453.59237 / 50],
  ])("converts explicitly reported %s %s using a provider gram serving", (quantity, unit, expected) => {
    expect(suggestedPortions({ ...mention, quantity, unit }, serving)).toBeCloseTo(expected);
  });

  test.each(["cup", "cups", "bowl", "handful", "portion", "large"])(
    "does not guess a %s-to-mass conversion", unit => {
      expect(suggestedPortions({ ...mention, quantity: 1, unit }, serving)).toBeNull();
    },
  );

  test("uses an explicitly matching volume or count serving without density assumptions", () => {
    expect(suggestedPortions(mention, serving)).toBe(2);
    expect(suggestedPortions({ ...mention, quantity: 2, unit: "cups" }, {
      ...serving, measurement_description: "cup", number_of_units: ".5",
    })).toBe(4);
  });

  test("does not convert to an unknown, zero, or different metric serving unit", () => {
    for (const invalid of [{ metric_serving_amount: "0" }, { metric_serving_amount: "unknown" },
      { metric_serving_unit: "ml" }]) {
      expect(suggestedPortions({ ...mention, quantity: 150, unit: "g" }, { ...serving, ...invalid })).toBeNull();
    }
  });
});

describe("reviewedRows", () => {
  test.each(["", " ", "0", "-1", "NaN", "Infinity", "101", "2 cups"])(
    "blocks missing or invalid reviewed amount %j", amount => {
      expect(() => reviewedRows([reviewed({ amount })])).toThrow(/Enter servings eaten/);
    },
  );

  test.each([
    { food_id: undefined }, { serving_id: "" }, { serving_id: "unknown" }, { servings: [] },
  ])("requires both a match and a selected serving: %j", changes => {
    expect(() => reviewedRows([reviewed(changes)])).toThrow(/Choose a database match and serving/);
  });

  test("requires a nonempty list and review of every retained item", () => {
    expect(() => reviewedRows([])).toThrow(/at least one item/);
    expect(() => reviewedRows([reviewed(), reviewed({ key: "rice", name: "Rice", amount: "" })]))
      .toThrow(/Rice/);
  });

  test("requires explicit review even when the description included an amount", () => {
    expect(suggestedPortions(mention, serving)).toBe(2);
    expect(() => reviewedRows([reviewed({ amount: "" })])).toThrow(/Enter servings eaten/);
  });

  test("allows explicit fractional amounts for initially unspecified quantities", () => {
    const rows = reviewedRows([reviewed({ quantity: null, unit: null, amount: ".5" })]);
    expect(rows[0].portions).toBe(.5);
  });

  test("calculator save items contain user names and identifiers, not provider content", () => {
    const input = reviewed();
    const before = JSON.stringify(input);
    const rows = reviewedRows([input]);
    expect(rows[0]).toMatchObject({ values: { calories: 74, protein_g: 6.29 },
      foodLabel: "Provider egg name", servingLabel: "1 egg" });
    expect(calculationItems(rows)).toEqual([
      { source: "fatsecret", name: "My eggs", portions: 2, food_id: "42", serving_id: "7" },
    ]);
    expect(JSON.stringify(calculationItems(rows))).not.toMatch(/calories|protein|foodLabel|servingLabel|expires|Provider egg name/);
    expect(JSON.stringify(input)).toBe(before);
  });

  test.each([NOW - 1, NOW])("blocks an expired provider view at %s", expires => {
    expect(() => reviewedRows([reviewed({ expires })])).toThrow(/expired/);
  });

  test("preserves an earlier expiry and never extends the fifteen-minute provider view", () => {
    expect(PROVIDER_VIEW_MS).toBe(15 * 60 * 1000);
    expect(reviewedRows([reviewed({ expires: NOW + 1000 })])[0].expires).toBe(NOW + 1000);
    expect(reviewedRows([reviewed({ expires: NOW + 60 * 60 * 1000 })])[0].expires)
      .toBe(NOW + PROVIDER_VIEW_MS);
  });
});

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  const close = jest.fn(), saved = jest.fn();
  function Harness() {
    const [visible, setVisible] = useState(true);
    return visible ? <MealAssistant voiceEnabled={false} onSaved={saved}
      onClose={() => { close(); setVisible(false); }} /> : null;
  }
  const screen = render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  await screen.findByLabelText("Meal description");
  return { ...screen, client, close, saved,
    cleanup: () => { screen.unmount(); client.clear(); } };
}

async function preview(screen: Awaited<ReturnType<typeof mount>>) {
  fireEvent.changeText(screen.getByLabelText("Meal description"), "I ate two eggs");
  fireEvent.press(screen.getByLabelText("Preview meal"));
  await screen.findByText("Review meal");
  await waitFor(() => expect(screen.queryByText("Working...")).toBeNull());
}

function selectServing(screen: Awaited<ReturnType<typeof mount>>, name = "My eggs") {
  fireEvent.press(screen.getByLabelText(`Serving size for ${name}: Choose serving size`));
  fireEvent.press(screen.getByLabelText("1 egg"));
}

function expectNoAutosave(saved: jest.Mock) {
  expect(saved).not.toHaveBeenCalled();
  expect(request.mock.calls.some(([path]) => /\/calculations|\/macros\/entries|\/recipes/.test(path))).toBe(false);
}

describe("MealAssistant review flow", () => {
  test("preview never logs or saves and cannot bypass serving review", async () => {
    const screen = await mount();
    try {
      await preview(screen);
      expect(screen.getByLabelText("Servings eaten for My eggs").props.value).toBe("");
      fireEvent.press(screen.getByLabelText("Continue to calculator"));
      expect(screen.getByText(/Choose a database match and serving/)).toBeTruthy();
      expect(calculator).not.toHaveBeenCalled();
      expectNoAutosave(screen.saved);
    } finally { screen.cleanup(); }
  });

  test("a missing amount remains blank after serving selection and blocks handoff", async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      if (path.endsWith("/drafts") && init?.method === "POST") return {
        ...draft, items: [{ ...mention, quantity: null, unit: null }],
      };
      return original(path, init);
    });
    const screen = await mount();
    try {
      await preview(screen);
      selectServing(screen);
      expect(screen.getByLabelText("Servings eaten for My eggs").props.value).toBe("");
      fireEvent.press(screen.getByLabelText("Continue to calculator"));
      expect(screen.getByText(/Enter servings eaten/)).toBeTruthy();
      expect(calculator).not.toHaveBeenCalled();
      expectNoAutosave(screen.saved);
    } finally { screen.cleanup(); }
  });

  test("all reviewed items prefill the calculator without saving", async () => {
    const screen = await mount();
    try {
      await preview(screen);
      selectServing(screen);
      expect(screen.getByLabelText("Servings eaten for My eggs").props.value).toBe("2");
      fireEvent.changeText(screen.getByLabelText("Servings eaten for My eggs"), "1.5");
      fireEvent.press(screen.getByLabelText("Continue to calculator"));
      await screen.findByTestId("meal-calculator-handoff");
      const props = calculator.mock.calls[0][0];
      expect(props.initialName).toBe("My breakfast");
      expect(props.initialMealLabel).toBe("breakfast");
      expect(calculationItems(props.initialRows!)).toEqual([
        { source: "fatsecret", name: "My eggs", portions: 1.5, food_id: "42", serving_id: "7" },
      ]);
      expectNoAutosave(screen.saved);
    } finally { screen.cleanup(); }
  });

  test("closing unmounts temporary results and discards the draft", async () => {
    const screen = await mount();
    try {
      await preview(screen);
      const call = request.mock.calls.find(([path, init]) => path.endsWith("/drafts") && init?.method === "POST")!;
      const requestId = JSON.parse(String(call[1]?.body)).request_id;
      fireEvent.press(screen.getByLabelText("Close meal assistant"));
      expect(screen.close).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Provider egg name")).toBeNull();
      expect(screen.queryByText("Review meal")).toBeNull();
      await waitFor(() => expect(request).toHaveBeenCalledWith(
        `/api/v1/nutrition/ai/drafts/${requestId}`, { method: "DELETE" },
      ));
      expectNoAutosave(screen.saved);
    } finally { screen.cleanup(); }
  });

  test.each(["inactive", "background"] as const)("%s clears provider results and reviewed rows", async state => {
    const screen = await mount();
    try {
      await preview(screen);
      selectServing(screen);
      fireEvent.press(screen.getByLabelText("Continue to calculator"));
      await screen.findByTestId("meal-calculator-handoff");
      act(() => onAppState(state));
      expect(screen.queryByTestId("meal-calculator-handoff")).toBeNull();
      expect(screen.queryByText("Provider egg name")).toBeNull();
      expect(screen.getByLabelText("Meal description")).toBeTruthy();
      expectNoAutosave(screen.saved);
    } finally { screen.cleanup(); }
  });

  test("background aborts an in-flight preview and late results cannot restore provider data", async () => {
    let resolve!: (value: MealDraft) => void;
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      if (path.endsWith("/drafts") && init?.method === "POST") {
        return new Promise<MealDraft>(done => { resolve = done; });
      }
      return original(path, init);
    });
    const screen = await mount();
    try {
      fireEvent.changeText(screen.getByLabelText("Meal description"), "I ate two eggs");
      fireEvent.press(screen.getByLabelText("Preview meal"));
      const call = request.mock.calls.find(([path]) => path.endsWith("/drafts"))!;
      act(() => onAppState("background"));
      expect(call[1]?.signal?.aborted).toBe(true);
      await act(async () => resolve(draft));
      expect(screen.queryByText("Review meal")).toBeNull();
      expect(screen.queryByText("Provider egg name")).toBeNull();
      expect(calculator).not.toHaveBeenCalled();
      expectNoAutosave(screen.saved);
    } finally { screen.cleanup(); }
  });
});
