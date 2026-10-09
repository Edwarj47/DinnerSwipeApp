import { fireEvent, render } from "@testing-library/react-native";
import { SearchField } from "@/components/SearchField";

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
