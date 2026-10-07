import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { RecipePhoto } from "@/features/recipes/RecipePhoto";

jest.mock("expo-image", () => ({ Image: jest.requireActual("react-native").Image }));

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
  screen.rerender(<RecipePhoto style={style} fallbackStyle={fallbackStyle} photoUrl="https://example.com/meal.jpg" testID="photo" />);
  expect(StyleSheet.flatten(screen.getByTestId("photo").props.style)).toMatchObject({ aspectRatio: 1.25 });
  expect(StyleSheet.flatten(screen.getByTestId("photo").props.style).height).toBeUndefined();
  fireEvent(screen.getByTestId("photo"), "error", { error: "404" });
  expect(StyleSheet.flatten(screen.getByTestId("photo").props.style)).toMatchObject({ height: 160 });
});

test("a failed URL falls back to the logo; a newly assigned photo renders normally", () => {
  const screen = render(<RecipePhoto photoUrl="https://example.com/broken.jpg" testID="photo" />);
  expect(screen.getByTestId("photo").props.source).toEqual({ uri: "https://example.com/broken.jpg" });
  fireEvent(screen.getByTestId("photo"), "error", { error: "404" });
  expect(screen.getByTestId("photo").props.source).toEqual(screen.getByTestId("photo").props.placeholder);
  screen.rerender(<RecipePhoto photoUrl="https://example.com/new.jpg" testID="photo" />);
  expect(screen.getByTestId("photo").props.source).toEqual({ uri: "https://example.com/new.jpg" });
  expect(screen.getByTestId("photo").props.contentFit).toBe("cover");
});
