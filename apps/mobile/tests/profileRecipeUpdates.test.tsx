import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import ProfileScreen from "@/app/(tabs)/profile";
import { AiRecipePanel } from "@/features/recipes/AiRecipePanel";
import { ManualRecipePanel } from "@/features/recipes/ManualRecipePanel";
import { RecipePhotoPicker } from "@/features/recipes/RecipePhotoPicker";
import { apiFetch } from "@/services/api";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(), requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn(), MediaTypeOptions: { Images: "Images" }
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({}) }));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("@/features/groups/HouseholdPanel", () => ({ HouseholdPanel: () => null }));
jest.mock("@/features/premium/PremiumMacroPanel", () => ({ PremiumMacroPanel: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/services/biometrics", () => ({ getBiometricSettings: async () => ({ enabled: false }) }));
jest.mock("@/services/tutorial", () => ({ openTutorial: jest.fn() }));
const request = jest.mocked(apiFetch);
const draft = { id: "draft-1", status: "succeeded", draft: { name: "Roasted carrots", description: "Easy dinner", servings: 2,
  difficulty: "easy", meal_type: "dinner", prep_minutes: 5, cook_minutes: 20, total_minutes: 25,
  ingredients: ["2 carrots", "1 tbsp oil"], instructions: ["Roast the carrots."], review_notes: [] } };
let premium = false;
let remaining = 3;
beforeEach(() => {
  premium = false; remaining = 3;
  jest.clearAllMocks();
  request.mockImplementation(async (path, init) => {
    if (path.endsWith("subscription/status")) return { premium_active: premium, basic_active: true, current_tier: premium ? "premium" : "basic", plans: [] };
    if (path.endsWith("auth/status")) return { email: "tester@example.com", email_verified: true };
    if (path.endsWith("/profile")) return { household_size: 2, allergens: [], disliked_ingredients: [], notification_preferences: {} };
    if (path.endsWith("/ai-recipes/usage")) return { enabled: true, remaining, used: 3 - remaining, limit: 3, resets_at: "2026-10-01T00:00:00Z" };
    if (path.endsWith("/ai-recipes")) return init?.method === "POST" ? draft : [];
    return {};
  });
});
function mount(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { ...screen, close: () => { screen.unmount(); client.clear(); } };
}
test("Account owns subscription and coupon codes; Basic cannot open macro controls", async () => {
  const screen = mount(<ProfileScreen />);
  try {
    await screen.findByText("tester@example.com");
    expect(screen.getByText("Subscription")).toBeTruthy();
    expect(screen.getByText("Coupon code")).toBeTruthy();
    expect(screen.getByText("Account Settings")).toBeTruthy();
    expect(screen.getByText("Planning")).toBeTruthy();
    expect(screen.getByText("Device security")).toBeTruthy();
    expect(screen.getByLabelText("App version")).toBeTruthy();
    expect(screen.queryByText("Account tools")).toBeNull();
    fireEvent.press(screen.getByText("Macro Tracker"));
    await screen.findByText("Available with Premium.");
    expect(screen.queryByText("Coupon code")).toBeNull();
    expect(request.mock.calls.some(([path]) => path.includes("/macros/"))).toBe(false);
    fireEvent.press(screen.getByLabelText("View subscription"));
    expect(screen.getByText("Coupon code")).toBeTruthy();
  } finally { screen.close(); }
});
test("Manual form has no prefilled samples and camera permission is handled", async () => {
  const screen = mount(<ManualRecipePanel />);
  try {
    expect(screen.queryByText("Ranch")).toBeNull();
    expect(screen.queryByText("Dinner")).toBeNull();
    expect(screen.getByLabelText("Recipe name").props.value).toBe("");
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({ granted: false } as never);
    fireEvent.press(screen.getByLabelText("Take photo"));
    await screen.findByText("Allow camera access in device settings to take a photo.");
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  } finally { screen.close(); }
});
test("native camera selection and cancellation", async () => {
  const select = jest.fn();
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({ granted: true } as never);
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({ canceled: true, assets: null });
  const screen = mount(<RecipePhotoPicker onSelect={select} />);
  try {
    fireEvent.press(screen.getByLabelText("Take photo"));
    await waitFor(() => expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(1));
    expect(select).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Take photo").props.accessibilityState.disabled).toBe(false));
    jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({ canceled: false, assets: [{ uri: "file:///recipe.jpg", width: 400, height: 300, mimeType: "image/jpeg" }] });
    fireEvent.press(screen.getByLabelText("Take photo"));
    await waitFor(() => expect(select).toHaveBeenCalledWith(expect.objectContaining({ uri: "file:///recipe.jpg" })));
  } finally { screen.close(); }
});
test("AI produces an editable draft without auto-saving, and exhausted Basic is disabled", async () => {
  const screen = mount(<AiRecipePanel />);
  try {
    await screen.findByText(/3 of 3 AI recipes/);
    fireEvent.changeText(screen.getByLabelText("Recipe idea"), "Roasted carrots");
    fireEvent.press(screen.getByLabelText("Create draft"));
    await screen.findByText("Review recipe");
    expect(screen.getByLabelText("Ingredients").props.value).toBe("2 carrots\n1 tbsp oil");
    expect(request.mock.calls.some(([path]) => path.endsWith("/approve") || path === "/api/v1/recipes")).toBe(false);
    fireEvent.changeText(screen.getByLabelText("Recipe name"), "My carrots");
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/ai-recipes/draft-1/approve", expect.objectContaining({ method: "POST", body: expect.stringContaining("My carrots") })));
  } finally { screen.close(); }
  remaining = 0;
  const locked = mount(<AiRecipePanel />);
  try {
    await locked.findByText(/0 of 3 AI recipes/);
    fireEvent.changeText(locked.getByLabelText("Recipe idea"), "Carrots");
    expect(locked.getByLabelText("Create draft").props.accessibilityState.disabled).toBe(true);
    expect(locked.getByLabelText("View Premium")).toBeTruthy();
  } finally { locked.close(); }
});
