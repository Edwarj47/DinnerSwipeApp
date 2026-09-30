import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { Pressable, Text } from "react-native";
import { OnboardingGuide } from "@/features/onboarding/OnboardingGuide";
import { TourTarget } from "@/features/onboarding/TourTarget";
import { useGuidedTour } from "@/features/onboarding/TourContext";
import { nextSectionIndex, TOUR_SECTIONS, tourStepsFor, TUTORIAL_VERSION } from "@/features/onboarding/tourSteps";
import { apiFetch } from "@/services/api";
import { openTutorial } from "@/services/tutorial";

const mockNavigate = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: mockNavigate }), usePathname: () => "/recipes" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
const request = jest.mocked(apiFetch);
let completed: boolean;
let premium: boolean;
let offline: boolean;
beforeEach(() => {
  completed = false; premium = true; offline = false; mockNavigate.mockReset();
  request.mockReset().mockImplementation(async (path, init) => {
    if (path.includes("subscription")) return { premium_active: premium };
    if (init?.method === "PATCH") {
      if (offline) throw new Error("Offline");
      return { tutorial_completed_at: "2026-09-29", tutorial_version_seen: TUTORIAL_VERSION };
    }
    return { tutorial_completed_at: completed ? "2026-09-29" : null };
  });
});
function Exercise() {
  const tour = useGuidedTour();
  const [tried, setTried] = useState(false);
  return <TourTarget id={tour?.step.id ?? "idle"}><Pressable accessibilityRole="button" accessibilityLabel="Actual app control" onPress={() => setTried(true)}>
    <Text>{tried ? "Control used" : "Ready"}</Text>
  </Pressable></TourTarget>;
}
function mount(gcTime = 0) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><OnboardingGuide><Exercise /></OnboardingGuide></QueryClientProvider>);
  return { ...screen, client, close: () => { screen.unmount(); client.clear(); } };
}
test("first tour navigates to real controls, can collapse, and skips whole sections", async () => {
  const screen = mount();
  try {
    await screen.findByText("Explore Dinner Swipe");
    fireEvent.press(screen.getByLabelText("Start tour"));
    expect(mockNavigate).toHaveBeenLastCalledWith({ pathname: "/recipes", params: { mode: "library", tour: expect.any(String) } });
    fireEvent.press(screen.getByLabelText("Try it"));
    expect(screen.queryByTestId("tour-callout")).toBeNull();
    fireEvent.press(screen.getByLabelText("Actual app control"));
    expect(screen.getByText("Control used")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Next tour step"));
    expect(mockNavigate).toHaveBeenLastCalledWith({ pathname: "/recipes", params: { mode: "add", method: "web", tour: expect.any(String) } });
    fireEvent.press(screen.getByLabelText("Previous tour step"));
    fireEvent.press(screen.getByLabelText("Skip tour section"));
    expect(mockNavigate).toHaveBeenLastCalledWith({ pathname: "/", params: { replace_slot_id: "", replace_name: "", tour: expect.any(String) } });
    expect(request.mock.calls.some(([, init]) => init?.method)).toBe(false);
    fireEvent.press(screen.getByLabelText("End tour"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/profile/onboarding", { method: "PATCH", body: JSON.stringify({ action: "dismiss_tutorial", tutorial_version: TUTORIAL_VERSION }) }));
    expect(screen.queryByTestId("tour-toolbar")).toBeNull();
  } finally { screen.close(); }
}, 20_000);

test("completed accounts are not nagged; replay allows selecting sections and finishing", async () => {
  completed = true; premium = false;
  const screen = mount();
  try {
    await waitFor(() => expect(screen.client.getQueryData(["profile"])).toBeDefined());
    expect(screen.queryByText("Explore Dinner Swipe")).toBeNull();
    act(() => openTutorial());
    expect(screen.queryByLabelText("Tour Premium macros")).toBeNull();
    for (const section of TOUR_SECTIONS.filter(item => !["recipes", "macros"].includes(item.id))) fireEvent.press(screen.getByLabelText(`Tour ${section.label}`));
    fireEvent.press(screen.getByLabelText("Start tour"));
    expect(screen.getByText("Tour 1 / 2")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Next tour step"));
    fireEvent.press(screen.getByLabelText("Finish tour"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/profile/onboarding", { method: "PATCH", body: JSON.stringify({ action: "complete_tutorial", tutorial_version: TUTORIAL_VERSION }) }));
    expect(screen.queryByTestId("tour-toolbar")).toBeNull();
  } finally { screen.close(); }
});

test("declining is persisted without moving the user or reopening after refresh", async () => {
  const screen = mount();
  try {
    await screen.findByLabelText("Not now");
    fireEvent.press(screen.getByLabelText("Not now"));
    await waitFor(() => expect(screen.client.getQueryData(["profile"])).toEqual({ tutorial_completed_at: "2026-09-29", tutorial_version_seen: TUTORIAL_VERSION }));
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => { await screen.client.invalidateQueries({ queryKey: ["profile"] }); });
    expect(screen.queryByText("Explore Dinner Swipe")).toBeNull();
  } finally { screen.close(); }
});

test("offline decline releases the app immediately and offers a retry", async () => {
  offline = true;
  const screen = mount();
  try {
    await screen.findByLabelText("Not now");
    fireEvent.press(screen.getByLabelText("Not now"));
    await screen.findByText("Tour preference not saved. You can keep using the app.");
    expect(screen.queryByText("Explore Dinner Swipe")).toBeNull();
    fireEvent.press(screen.getByLabelText("Actual app control"));
    expect(screen.getByText("Control used")).toBeTruthy();
    offline = false;
    fireEvent.press(screen.getByLabelText("Retry"));
    await waitFor(() => expect(screen.queryByText("Tour preference not saved. You can keep using the app.")).toBeNull());
  } finally { screen.close(); }
});

test("late completion after unmount does not overwrite a new account profile", async () => {
  let resolve!: (data: unknown) => void;
  // Keep the new account's unobserved cache entry alive until the assertion.
  const screen = mount(Infinity);
  await screen.findByLabelText("Not now");
  request.mockImplementation(() => new Promise(done => { resolve = done; }));
  fireEvent.press(screen.getByLabelText("Not now"));
  screen.unmount();
  screen.client.setQueryData(["profile"], { email: "new-account@example.com" });
  await act(async () => resolve({ email: "previous-account@example.com" }));
  expect(screen.client.getQueryData(["profile"])).toEqual({ email: "new-account@example.com" });
  screen.client.clear();
});

test("section selection honors Premium access and skips sibling steps", () => {
  expect(tourStepsFor(["recipes", "macros"], false).map(step => step.id)).toEqual(["recipe-library", "recipe-add"]);
  const steps = tourStepsFor(["recipes", "grocery"], true);
  expect(nextSectionIndex(steps, 0)).toBe(2);
  expect(nextSectionIndex(steps, 2)).toBe(steps.length);
});
