import { fireEvent, render } from "@testing-library/react-native";
import { SearchField } from "@/components/SearchField";
import { Colors } from "@/components/theme";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

test("search clear button clears the controlled value and reserves a stable space", () => {
  const change = jest.fn();
  const screen = render(<SearchField accessibilityLabel="Search recipes" value="eggs" onChangeText={change} />);
  fireEvent.press(screen.getByLabelText("Clear search"));
  expect(change).toHaveBeenCalledWith("");
  screen.rerender(<SearchField accessibilityLabel="Search recipes" value="" onChangeText={change} />);
  expect(screen.queryByLabelText("Clear search")).toBeNull();
  expect(screen.getByLabelText("Search recipes").props.clearButtonMode).toBe("never");
});

test("locked searches cannot be cleared during a save", () => {
  const change = jest.fn();
  const screen = render(<SearchField value="eggs" editable={false} onChangeText={change} />);
  fireEvent.press(screen.getByLabelText("Clear search"));
  expect(change).not.toHaveBeenCalled();
});

test("empty searches have an explicit visible placeholder without needing focus", () => {
  const screen = render(<SearchField accessibilityLabel="Search recipes" value="" onChangeText={jest.fn()} />);
  expect(screen.getByPlaceholderText("Search...").props.placeholderTextColor).toBe(Colors.muted);
  expect(screen.getByLabelText("Search recipes").props.value).toBe("");
  expect(screen.queryByLabelText("Clear search")).toBeNull();
  screen.rerender(<SearchField accessibilityLabel="Search recipes" placeholder="Search saved recipes" value="" onChangeText={jest.fn()} />);
  expect(screen.getByPlaceholderText("Search saved recipes").props.placeholderTextColor).toBe(Colors.muted);
});

test("explicit placeholder colors and input settings remain supported", () => {
  const screen = render(<SearchField value="" onChangeText={jest.fn()} placeholder="Find food" placeholderTextColor="#555555" autoCapitalize="words" />);
  expect(screen.getByPlaceholderText("Find food").props).toMatchObject({ placeholderTextColor: "#555555", autoCapitalize: "words" });
});
