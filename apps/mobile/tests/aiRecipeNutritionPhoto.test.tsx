import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import { AiRecipePanel } from "@/features/recipes/AiRecipePanel";
import { AiRecipeJob } from "@/features/recipes/aiRecipeTypes";
import { ManualRecipePanel } from "@/features/recipes/ManualRecipePanel";
import { RecipePhotoEditor } from "@/features/recipes/RecipePhotoEditor";
import { privacySections, termsSections } from "@/features/legal/legalContent";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(), requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn(), MediaTypeOptions: { Images: "Images" }
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
const request = jest.mocked(apiFetch);
const nutrition = { calories: 160, protein_g: 30, carbs_g: 4, fat_g: 3, fiber_g: 2 };
const draft: AiRecipeJob = { id: "label", status: "succeeded", draft: {
  name: "Protein shake", description: "One shake (11 fl oz).", servings: 1,
  prep_minutes: 0, cook_minutes: 0, total_minutes: 0, difficulty: "easy", meal_type: "snack",
  ingredients: ["1 shake"], instructions: ["Serve one shake."], review_notes: [],
  nutrition, nutrition_basis: "serving"
} };
function mount(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { ...screen, client, close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => {
  jest.clearAllMocks();
  request.mockReset().mockResolvedValue({});
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({ granted: true } as never);
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({ canceled: false, assets: [
    { uri: "file:///shake.jpg", width: 400, height: 600, mimeType: "image/jpeg" }
  ] });
});

test("label values populate review and user corrections are saved", async () => {
  const screen = mount(<ManualRecipePanel initialDraft={draft} />);
  try {
    expect(screen.getByLabelText("Calories").props.value).toBe("160");
    expect(screen.getByLabelText("Protein (g)").props.value).toBe("30");
    expect(screen.getByLabelText("Fiber (g)").props.value).toBe("2");
    expect(screen.getByLabelText("Prep minutes").props.value).toBe("0");
    fireEvent.changeText(screen.getByLabelText("Protein (g)"), "31");
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await waitFor(() => expect(request).toHaveBeenCalled());
    const body = JSON.parse(request.mock.calls[0][1]!.body as string);
    expect(body.nutrition).toEqual({ ...nutrition, protein_g: 31 });
  } finally { screen.close(); }
});

test("whole-container totals normalize while old drafts remain empty", async () => {
  const whole: AiRecipeJob = { ...draft, draft: { ...draft.draft!, servings: 2, nutrition_basis: "recipe" } };
  const screen = mount(<ManualRecipePanel initialDraft={whole} />);
  try {
    expect(screen.getByLabelText("Whole recipe").props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await waitFor(() => expect(request).toHaveBeenCalled());
    const body = JSON.parse(request.mock.calls[0][1]!.body as string);
    expect(body.nutrition).toEqual({ calories: 80, protein_g: 15, carbs_g: 2, fat_g: 1.5, fiber_g: 1 });
  } finally { screen.close(); }
  const old = mount(<ManualRecipePanel initialDraft={{ ...draft, draft: { ...draft.draft!, nutrition: undefined } }} />);
  try { expect(old.getByLabelText("Calories").props.value).toBe(""); }
  finally { old.close(); }
});

test("OpenAI disclosure is in Privacy and Terms, not the AI input screen", async () => {
  request.mockImplementation(async path => path.endsWith("usage") ? { enabled: true, remaining: 3, limit: 3, resets_at: "2026-11-01" } : []);
  const screen = mount(<AiRecipePanel />);
  try {
    await screen.findByText(/3 of 3 AI recipes/);
    expect(screen.queryByText(/sent to OpenAI/)).toBeNull();
    expect(privacySections.some(section => section.body.includes("sends the description and photo you provide to OpenAI"))).toBe(true);
    expect(termsSections.some(section => section.body.includes("selected photo to OpenAI"))).toBe(true);
  } finally { screen.close(); }
});

test("owners can attach a photo after creation and refresh recipe and week views", async () => {
  request.mockResolvedValue({ id: "shake", photo_url: "https://example.test/new.jpg" });
  const screen = mount(<RecipePhotoEditor recipe={{ id: "shake", name: "Shake", can_edit: true } as Recipe} />);
  const invalidate = jest.spyOn(screen.client, "invalidateQueries");
  try {
    fireEvent.press(screen.getByLabelText("Add photo"));
    fireEvent.press(screen.getByLabelText("Take photo"));
    await screen.findByText("Photo updated.");
    expect(request).toHaveBeenCalledWith("/api/v1/recipes/shake/photo", expect.objectContaining({ method: "PUT", body: expect.any(FormData) }));
    expect(screen.getByLabelText("Change photo")).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["recipes"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["weekly-plan"] });
    await waitFor(() => expect(screen.queryByText("Photo updated.")).toBeNull(), { timeout: 4500 });
  } finally { screen.close(); }
});

test("cancel and upload failure leave the old photo; other users cannot edit", async () => {
  const recipe = { id: "shake", name: "Shake", can_edit: true, photo_url: "https://example.test/old.jpg" } as Recipe;
  const screen = mount(<RecipePhotoEditor recipe={recipe} />);
  try {
    fireEvent.press(screen.getByLabelText("Change photo"));
    jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValueOnce({ canceled: true, assets: null });
    fireEvent.press(screen.getByLabelText("Take photo"));
    await waitFor(() => expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(1));
    expect(request).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Take photo").props.accessibilityState.disabled).toBe(false));
    request.mockRejectedValueOnce(new Error("Upload failed"));
    fireEvent.press(screen.getByLabelText("Take photo"));
    await screen.findByText("Upload failed");
    expect(screen.queryByText("Photo updated.")).toBeNull();
    fireEvent.press(screen.getByLabelText("Cancel"));
    expect(screen.getByLabelText("Change photo")).toBeTruthy();
  } finally { screen.close(); }
  const other = mount(<RecipePhotoEditor recipe={{ ...recipe, can_edit: false }} />);
  try { expect(other.queryByLabelText("Change photo")).toBeNull(); }
  finally { other.close(); }
});
