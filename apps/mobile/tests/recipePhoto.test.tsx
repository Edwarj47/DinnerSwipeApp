import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { RecipePhoto } from "@/features/recipes/RecipePhoto";
import { apiFetch } from "@/services/api";

jest.mock("expo-image", () => ({ Image: jest.requireActual("react-native").Image }));
jest.mock("@/services/api", () => ({ API_URL: "https://dinner.test", apiFetch: jest.fn().mockRejectedValue(new Error("Unavailable")) }));
const photo = (name: string) => `https://dinner.test/api/v1/media/recipes/${name}?v=image-version&token=short-lived`;

test.each([undefined, null, "", "   "])("missing photo %s renders the logo as the actual source", photoUrl => {
  const screen = render(<RecipePhoto photoUrl={photoUrl} testID="photo" />);
  expect(screen.getByTestId("photo").props.source).toEqual(screen.getByTestId("photo").props.placeholder);
  expect(screen.getByTestId("photo").props.source).toBeTruthy();
  expect(screen.getByTestId("photo").props.contentFit).toBe("contain");
});

test("compact logo fallback does not change the size of an actual recipe photo", () => {
  const style = { width: "100%" as const, aspectRatio: 1.25 };
  const fallbackStyle = { aspectRatio: undefined, height: 160 };
  const screen = render(<RecipePhoto style={style} fallbackStyle={fallbackStyle} testID="photo" />);
  expect(StyleSheet.flatten(screen.getByTestId("photo").props.style)).toMatchObject({ height: 160 });
  screen.rerender(<RecipePhoto style={style} fallbackStyle={fallbackStyle} photoUrl={photo("meal")} testID="photo" />);
  expect(StyleSheet.flatten(screen.getByTestId("photo").props.style)).toMatchObject({ aspectRatio: 1.25 });
  expect(StyleSheet.flatten(screen.getByTestId("photo").props.style).height).toBeUndefined();
  fireEvent(screen.getByTestId("photo"), "error", { error: "404" });
  expect(StyleSheet.flatten(screen.getByTestId("photo").props.style)).toMatchObject({ height: 160 });
});

test("a failed URL falls back to the logo; a newly assigned photo renders normally", () => {
  const screen = render(<RecipePhoto photoUrl={photo("broken")} testID="photo" />);
  expect(screen.getByTestId("photo").props.source).toMatchObject({ uri: photo("broken") });
  fireEvent(screen.getByTestId("photo"), "error", { error: "404" });
  expect(screen.getByTestId("photo").props.source).toEqual(screen.getByTestId("photo").props.placeholder);
  screen.rerender(<RecipePhoto photoUrl={photo("new")} testID="photo" />);
  expect(screen.getByTestId("photo").props.source).toMatchObject({ uri: photo("new") });
  expect(screen.getByTestId("photo").props.contentFit).toBe("cover");
});

test("external image URLs never initiate a direct viewer request", () => {
  const screen = render(<RecipePhoto photoUrl="https://tracker.example/private.jpg" testID="photo" />);
  expect(screen.getByTestId("photo").props.source).toEqual(screen.getByTestId("photo").props.placeholder);
});

test("an expired private photo renews silently once without retry loops", async () => {
  const fresh = photo("meal").replace("short-lived", "renewed");
  jest.mocked(apiFetch).mockResolvedValueOnce({ photo_url: fresh });
  const screen = render(<RecipePhoto photoUrl={photo("meal")} testID="photo" />);
  fireEvent(screen.getByTestId("photo"), "error", { error: "401" });
  await waitFor(() => expect(screen.getByTestId("photo").props.source.uri).toBe(fresh));
  expect(apiFetch).toHaveBeenCalledWith("/api/v1/media/recipes/meal/link");
  const count = jest.mocked(apiFetch).mock.calls.length;
  fireEvent(screen.getByTestId("photo"), "error", { error: "404" });
  expect(jest.mocked(apiFetch).mock.calls).toHaveLength(count);
});
