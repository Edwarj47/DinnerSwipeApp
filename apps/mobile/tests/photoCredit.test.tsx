import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react-native";
import { Linking } from "react-native";
import { PhotoCredit } from "@/components/PhotoCredit";
import { CandidatePreview } from "@/features/contentAutomation/CandidatePreview";
import { Candidate } from "@/features/contentAutomation/types";
import { RecipeDetailSheet } from "@/features/recipes/RecipeDetailSheet";
import { WorkoutDetail } from "@/features/workouts/WorkoutDetail";
import { WorkoutSlot } from "@/features/workouts/types";
import { PhotoCredit as PhotoCreditData, photoCreditLink } from "@/services/photoCredit";
import { Recipe } from "@/services/types";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: jest.requireActual("react-native").Image }));
jest.mock("@/services/api", () => ({ API_URL: "https://dinner.test", apiFetch: jest.fn(async () => ({})) }));
jest.mock("@/features/recipes/RecipePhotoEditor", () => ({ RecipePhotoEditor: () => null }));
jest.mock("@/features/recipes/RecipeNutritionPanel", () => ({ RecipeNutritionPanel: () => null }));

const credit: PhotoCreditData = {
  text: '"Lemon chickpea bowls" by Example Photographer (c) 2026, Wikimedia Commons',
  source_url: "https://commons.wikimedia.org/wiki/File:Lemon_chickpea_bowls.jpg",
  license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
  license: "CC BY-SA 4.0"
};
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test("photo credit preserves the complete title/creator text and opens labeled source/license commands", () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  const screen = render(<PhotoCredit credit={credit} />);
  expect(screen.getByText(`Photo: ${credit.text}`)).toBeTruthy();
  expect(screen.getByText(credit.license!)).toBeTruthy();
  expect(screen.queryByText(credit.source_url!)).toBeNull();
  expect(screen.queryByText(credit.license_url!)).toBeNull();
  fireEvent.press(screen.getByLabelText("Open photo source"));
  fireEvent.press(screen.getByLabelText("Open photo license"));
  expect(open.mock.calls.map(([url]) => url)).toEqual([credit.source_url, credit.license_url]);
});

test.each([undefined, null, { ...credit, text: " " }])("old or empty credits add no UI: %s", value => {
  const screen = render(<PhotoCredit credit={value} />);
  expect(screen.toJSON()).toBeNull();
});

test("a complete attribution does not repeat its photo label", () => {
  const text = `Photo: ${credit.text}`;
  const screen = render(<PhotoCredit credit={{ ...credit, text }} />);
  expect(screen.getByText(text)).toBeTruthy();
  expect(screen.queryByText(`Photo: ${text}`)).toBeNull();
});

test("compact credit opens details without opening a remote URL", () => {
  const details = jest.fn();
  const open = jest.spyOn(Linking, "openURL");
  const screen = render(<PhotoCredit credit={credit} onDetails={details} />);
  fireEvent.press(screen.getByLabelText("View photo credit"));
  expect(details).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
});

test("unsafe URLs do not hide attribution text or expose URL buttons", () => {
  const screen = render(<PhotoCredit credit={{ ...credit, source_url: "javascript:alert(1)", license_url: "https://evil.example/license" }} />);
  expect(screen.getByText(`Photo: ${credit.text}`)).toBeTruthy();
  expect(screen.queryByLabelText("Open photo source")).toBeNull();
  expect(screen.queryByLabelText("Open photo license")).toBeNull();
});

test("a source-link failure is visible and keeps the full credit", async () => {
  jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("Unavailable"));
  const screen = render(<PhotoCredit credit={credit} />);
  fireEvent.press(screen.getByLabelText("Open photo source"));
  await screen.findByText("Couldn't open the photo source.");
  expect(screen.getByText(`Photo: ${credit.text}`)).toBeTruthy();
});

test.each([
  "https://commons.wikimedia.org/wiki/File:Example.jpg", "https://www.nhlbi.nih.gov/health/educational/wecan/",
  "https://www.myplate.gov/recipes", "https://creativecommons.org/licenses/by/4.0/", "https://www.creativecommons.org/publicdomain/zero/1.0/"
])("permits an HTTPS public credit destination: %s", url => expect(photoCreditLink(url)).toBe(url));

test.each([
  "http://commons.wikimedia.org/wiki/File:Example.jpg", "https://commons.wikimedia.org.evil.example/file", "https://fake.gov.evil.example/file",
  "https://commons.wikimedia.org@evil.example/file", "https://user:secret@commons.wikimedia.org/file", "https://commons.wikimedia.org:8443/file",
  "file:///tmp/photo.jpg", "/api/v1/media/private", "https://127.0.0.1/photo", "https://localhost/photo", "https://upload.wikimedia.org/photo.jpg", "javascript:alert(1)"
])("rejects a non-allowlisted credit destination: %s", url => expect(photoCreditLink(url)).toBeNull());

const recipe: Recipe = {
  id: "recipe-credit", name: "Lemon chickpea bowls", servings: 2, difficulty: "easy", meal_type: "dinner", source_type: "manual",
  photo_url: "https://dinner.test/api/v1/media/recipes/credit?token=mock", photo_credit: credit,
  validation_status: "approved", validation_warnings: [], duplicate_status: "new", image_status: "ready",
  ingredients: [], instructions: [], tags: [], is_favorite: false, is_hidden: false
};
const candidate: Candidate = {
  id: "candidate-credit", kind: "recipe", status: "pending", title: recipe.name, photo_url: recipe.photo_url!, photo_credit: credit,
  source_url: null, source_name: null, warnings: [], payload: { ingredients: [], instructions: [] }
};
const slot: WorkoutSlot = {
  id: "slot-credit", slot_date: null, sort_order: 0, template_id: "workout-credit",
  snapshot: { id: "workout-credit", title: "Strength", category: "full_body", exercises: [], owner_id: "mock", photo_credit: credit }
};

test.each([
  ["candidate preview", <CandidatePreview candidate={candidate} onClose={jest.fn()} />],
  ["recipe details", <RecipeDetailSheet recipe={recipe} visible onClose={jest.fn()} />],
  ["workout snapshot details", <WorkoutDetail template={slot.snapshot} onClose={jest.fn()} />]
])("%s renders the shared photo credit", (_name, element) => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } } });
  client.setQueryData(["profile"], { notification_preferences: {} });
  const screen = render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  try {
    expect(screen.getByText(`Photo: ${credit.text}`)).toBeTruthy();
    expect(screen.getByLabelText("Open photo source")).toBeTruthy();
    expect(screen.getByLabelText("Open photo license")).toBeTruthy();
  } finally { screen.unmount(); client.clear(); }
});
