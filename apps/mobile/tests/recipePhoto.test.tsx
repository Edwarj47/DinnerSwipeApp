import { fireEvent, render } from "@testing-library/react-native";
import { RecipePhoto } from "@/features/recipes/RecipePhoto";

jest.mock("expo-image", () => ({ Image: jest.requireActual("react-native").Image }));

test.each([undefined, null, "", "   "])("missing photo %s renders the logo as the actual source", photoUrl => {
  const screen = render(<RecipePhoto photoUrl={photoUrl} testID="photo" />);
  expect(screen.getByTestId("photo").props.source).toEqual(screen.getByTestId("photo").props.placeholder);
  expect(screen.getByTestId("photo").props.source).toBeTruthy();
  expect(screen.getByTestId("photo").props.contentFit).toBe("contain");
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
