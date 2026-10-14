import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { useCallback, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { MealAssistant } from "@/features/premium/MealAssistant";
import { MacroCalculator } from "@/features/premium/MacroCalculator";
import { calculationItems, PROVIDER_VIEW_MS } from "@/features/premium/calculator";
import {
  MealDraft,
  MealDraftItem,
  ReviewedFood,
  prefillServing,
  reviewedRows,
  suggestedPortions,
} from "@/features/premium/mealAssistant";
import { apiFetch } from "@/services/api";
import { useOfflineStatus } from "@/services/offlineStore";
import { useMealVoice } from "@/features/premium/useMealVoice";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn(), ApiError: class extends Error { status = 503; } }));
jest.mock("@/features/premium/useMealVoice", () => ({
  useMealVoice: jest.fn(),
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
const voiceHook = jest.mocked(useMealVoice);
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
  voiceHook.mockReset().mockReturnValue({ supported: false, recording: false, audio: null, error: "",
    start: jest.fn(), stop: jest.fn(), clear: jest.fn() });
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
    [1, "oz", 28.349523125 / 50], [1, "lb", 453.59237 / 50], [1, "pound", 453.59237 / 50],
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

  test("uses declared liquid volume and spoon aliases without inferring density", () => {
    expect(suggestedPortions({ ...mention, quantity: .25, unit: "liters" }, {
      ...serving, metric_serving_amount: "100", metric_serving_unit: "ml",
    })).toBe(2.5);
    expect(suggestedPortions({ ...mention, quantity: 2, unit: "tablespoons" }, {
      ...serving, measurement_description: "tbsp", number_of_units: "1",
    })).toBe(2);
    expect(suggestedPortions({ ...mention, quantity: 100, unit: "ml" }, serving)).toBeNull();
  });

  test("never fills a nonfinite quantity or divides by nonfinite provider amounts", () => {
    expect(suggestedPortions({ ...mention, quantity: Infinity }, serving)).toBeNull();
    expect(suggestedPortions(mention, { ...serving, number_of_units: "Infinity" })).toBeNull();
  });
});

describe("prefillServing", () => {
  test("prefills explicit eggs, cups and grams with matching portions", () => {
    expect(prefillServing(mention)).toEqual({ serving_id: "7", recommended_serving_id: "7", amount: "2" });
    expect(prefillServing({ ...mention, quantity: .5, unit: "cup", servings: [serving,
      { ...serving, serving_id: "8", measurement_description: "cup", number_of_units: ".5", serving_description: "1/2 cup" },
    ] })).toMatchObject({ serving_id: "8", amount: "1" });
    expect(prefillServing({ ...mention, quantity: 150, unit: "g", servings: [
      { ...serving, serving_id: "8", metric_serving_amount: "1", measurement_description: "g" },
      { ...serving, serving_id: "9", metric_serving_amount: "100", measurement_description: "g", number_of_units: "100" },
    ] })).toMatchObject({ serving_id: "9", amount: "1.5" });
  });

  test("recommends a large egg over gram or extra-large servings for an unspecified egg size", () => {
    expect(prefillServing({ ...mention, name: "eggs", quantity: 4, servings: [
      { ...serving, serving_id: "1", measurement_description: "g" },
      { ...serving, serving_id: "2", measurement_description: "extra large", serving_description: "1 extra large" },
      { ...serving, serving_id: "3", measurement_description: "large", serving_description: "1 large" },
    ] })).toMatchObject({ serving_id: "3", recommended_serving_id: "3", amount: "4" });
  });

  test.each([{ quantity: null, unit: null }, { quantity: 1, unit: "bowl" }])(
    "does not invent a portion for missing or unmeasurable amounts: %j", changes => {
      expect(prefillServing({ ...mention, ...changes })).toMatchObject({ serving_id: "", amount: "" });
    },
  );

  test("preserves tiny positive portions instead of rounding them to zero", () => {
    expect(Number(prefillServing({ ...mention, quantity: .00000000001, unit: "g" }).amount)).toBeGreaterThan(0);
  });

  test("honors explicitly stated egg size and does not substitute another size", () => {
    const medium = { ...serving, measurement_description: "medium", serving_description: "1 medium" };
    expect(prefillServing({ ...mention, name: "large eggs", servings: [medium] }))
      .toMatchObject({ serving_id: "", amount: "" });
    expect(prefillServing({ ...mention, name: "medium eggs", servings: [medium] }))
      .toMatchObject({ serving_id: "7", amount: "2" });
  });

  test("rejects invalid IDs and portions outside calculator limits", () => {
    expect(prefillServing({ ...mention, quantity: 101 })).toMatchObject({ serving_id: "", amount: "" });
    expect(prefillServing({ ...mention, servings: [{ ...serving, serving_id: "bad" }] }))
      .toMatchObject({ serving_id: "", amount: "" });
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

async function mount(voiceEnabled = false) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  const close = jest.fn(), saved = jest.fn();
  function Harness() {
    const [visible, setVisible] = useState(true);
    return visible ? <MealAssistant voiceEnabled={voiceEnabled} onSaved={saved}
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

function expectNoAutosave(saved: jest.Mock) {
  expect(saved).not.toHaveBeenCalled();
  expect(request.mock.calls.some(([path]) => /\/calculations|\/macros\/entries|\/recipes/.test(path))).toBe(false);
}

describe("MealAssistant review flow", () => {
  test("the description starts empty with no example or repeated provider disclosures", async () => {
    const screen = await mount();
    try {
      expect(screen.getByLabelText("Meal description").props.value).toBe("");
      expect(screen.getByLabelText("Meal description").props.placeholder).toBeUndefined();
      expect(screen.queryByText(/Your description is sent to OpenAI/)).toBeNull();
    } finally { screen.cleanup(); }
  });
  test("preview prefills explicit amounts but never logs or saves without confirmation", async () => {
    const screen = await mount();
    try {
      await preview(screen);
      expect(screen.getByLabelText("Servings eaten for My eggs").props.value).toBe("2");
      expect(screen.getByLabelText("Serving size for My eggs: 1 egg (Recommended)")).toBeTruthy();
      expect(screen.getByText("Provider egg name (Recommended)")).toBeTruthy();
      expect(calculator).not.toHaveBeenCalled();
      expectNoAutosave(screen.saved);
      fireEvent.press(screen.getByLabelText("Continue to calculator"));
      await screen.findByTestId("meal-calculator-handoff");
      expect(calculationItems(calculator.mock.calls[0][0].initialRows!)[0].portions).toBe(2);
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
      fireEvent.press(screen.getByLabelText("Serving size for My eggs: Choose serving size"));
      fireEvent.press(screen.getByLabelText("1 egg"));
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

  test("a changed food match prefills its servings while the original recommendation stays identified", async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      if (path.includes("/foods/search")) return { data: { foods: { food: [
        { food_id: "42", food_name: "Provider egg name" }, { food_id: "99", food_name: "Alternative eggs" },
      ] } } };
      if (path.endsWith("/foods/99")) return { data: { food: { food_name: "Alternative eggs", servings: { serving: [
        { ...serving, serving_id: "9", number_of_units: ".5", serving_description: "1/2 egg" },
      ] } } } };
      return original(path, init);
    });
    const screen = await mount();
    try {
      await preview(screen);
      fireEvent.press(screen.getByLabelText("Change match"));
      fireEvent.press(screen.getByLabelText("Search Database"));
      await screen.findByLabelText("Provider egg name (Recommended)");
      fireEvent.press(screen.getByLabelText("Alternative eggs"));
      await screen.findByLabelText("Serving size for My eggs: 1/2 egg (Recommended)");
      expect(screen.getByLabelText("Servings eaten for My eggs").props.value).toBe("4");
      expect(screen.getByText("Alternative eggs", { exact: true })).toBeTruthy();
      fireEvent.press(screen.getByLabelText("Continue to calculator"));
      await screen.findByTestId("meal-calculator-handoff");
      expect(calculationItems(calculator.mock.calls[0][0].initialRows!)).toEqual([
        { source: "fatsecret", name: "My eggs", food_id: "99", serving_id: "9", portions: 4 },
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
      expect(screen.queryByText("Provider egg name (Recommended)")).toBeNull();
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
      fireEvent.press(screen.getByLabelText("Continue to calculator"));
      await screen.findByTestId("meal-calculator-handoff");
      act(() => onAppState(state));
      expect(screen.queryByTestId("meal-calculator-handoff")).toBeNull();
      expect(screen.queryByText("Provider egg name (Recommended)")).toBeNull();
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

function enableVoice() {
  const clear = jest.fn();
  const audio = new Blob(["synthetic clip"], { type: "audio/webm" });
  voiceHook.mockImplementation(function useMockVoice() {
    const [recording, setRecording] = useState(false);
    const [clip, setClip] = useState<Blob | null>(null);
    const reset = useCallback(() => { clear(); setRecording(false); setClip(null); return undefined; }, []);
    return { supported: true, recording, audio: clip, error: "",
      start: async () => { setClip(null); setRecording(true); },
      stop: () => { setRecording(false); setClip(audio); }, clear: reset };
  });
  return { clear, audio };
}

function transcriptionCalls() { return request.mock.calls.filter(([path]) => path.endsWith("/transcriptions")); }
function transcriptionId(body: unknown) {
  const form = body as { get?: (key: string) => unknown; getParts?: () => { fieldName: string; string?: string }[] };
  return form.get?.("request_id") ?? form.getParts?.().find(part => part.fieldName === "request_id")?.string;
}
async function recordAndStop(screen: Awaited<ReturnType<typeof mount>>) {
  fireEvent.press(screen.getByLabelText("Record meal"));
  expect(transcriptionCalls()).toHaveLength(0);
  fireEvent.press(screen.getByLabelText("Stop recording"));
  await waitFor(() => expect(transcriptionCalls()).toHaveLength(1));
}

describe("automatic meal transcription", () => {
  test("stopping fills editable words once, preserves typed text, and never previews or saves automatically", async () => {
    const voice = enableVoice();
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => path.endsWith("/transcriptions") ? { text: "two eggs" } : original(path, init));
    const screen = await mount(true);
    try {
      fireEvent.changeText(screen.getByLabelText("Meal description"), "Breakfast was");
      expect(screen.queryByLabelText("Transcribe")).toBeNull();
      expect(screen.queryByText(/Audio is sent to OpenAI/)).toBeNull();
      await recordAndStop(screen);
      await waitFor(() => expect(screen.getByLabelText("Meal description").props.value).toBe("Breakfast was two eggs"));
      expect(screen.getByLabelText("Meal description").props.editable).toBe(true);
      fireEvent.changeText(screen.getByLabelText("Meal description"), "Breakfast was three eggs");
      expect(transcriptionCalls()).toHaveLength(1);
      expect(request.mock.calls.some(([path, init]) => path.endsWith("/drafts") && init?.method === "POST")).toBe(false);
      expect(voice.clear).toHaveBeenCalled();
      expectNoAutosave(screen.saved);
    } finally { screen.cleanup(); }
  });

  test("a failed transcription does not loop; explicit retry reuses the completed clip and request ID", async () => {
    enableVoice();
    const original = request.getMockImplementation()!;
    let failures = 1;
    request.mockImplementation(async (path, init) => {
      if (path.endsWith("/transcriptions")) {
        if (failures-- > 0) throw new Error("Connection interrupted");
        return { text: "two eggs" };
      }
      return original(path, init);
    });
    const screen = await mount(true);
    try {
      await recordAndStop(screen);
      await screen.findByLabelText("Retry transcription");
      fireEvent.changeText(screen.getByLabelText("Meal description"), "Breakfast:");
      expect(transcriptionCalls()).toHaveLength(1);
      fireEvent.press(screen.getByLabelText("Retry transcription"));
      await waitFor(() => expect(screen.getByLabelText("Meal description").props.value).toBe("Breakfast: two eggs"));
      const calls = transcriptionCalls();
      expect(calls).toHaveLength(2);
      expect(transcriptionId(calls[0][1]?.body)).toBeTruthy();
      expect(transcriptionId(calls[0][1]?.body)).toBe(transcriptionId(calls[1][1]?.body));
      expectNoAutosave(screen.saved);
    } finally { screen.cleanup(); }
  });

  test.each(["cancel", "background", "close"])("%s aborts transcription and drops late words", async mode => {
    const voice = enableVoice();
    let resolve!: (value: { text: string }) => void;
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => path.endsWith("/transcriptions")
      ? new Promise<{ text: string }>(done => { resolve = done; }) : original(path, init));
    const screen = await mount(true);
    try {
      fireEvent.changeText(screen.getByLabelText("Meal description"), "Keep my text");
      await recordAndStop(screen);
      if (mode === "cancel") fireEvent.press(screen.getByLabelText("Cancel transcription"));
      else if (mode === "background") act(() => onAppState("background"));
      else fireEvent.press(screen.getByLabelText("Close meal assistant"));
      expect(transcriptionCalls()[0][1]?.signal?.aborted).toBe(true);
      expect(voice.clear).toHaveBeenCalled();
      await act(async () => resolve({ text: "late transcript" }));
      if (mode !== "close") expect(screen.getByLabelText("Meal description").props.value).toBe("Keep my text");
      expect(transcriptionCalls()).toHaveLength(1);
      expectNoAutosave(screen.saved);
    } finally { screen.cleanup(); }
  });
});
