import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@/components/OfflineStatusBar", () => ({ OfflineStatusBar: () => null }));

test.each([
  ["secondary", Colors.ink, Colors.surface],
  ["primary", "#fff", Colors.tomato],
  ["danger", "#fff", Colors.danger],
  ["quiet", Colors.ink, "transparent"],
  ["quiet-danger", Colors.danger, "transparent"]
] as const)("%s buttons retain readable labels and a 44px touch target", (variant, color, backgroundColor) => {
  const press = jest.fn();
  const screen = render(<Button label="Action" variant={variant} onPress={press} />);
  const button = screen.getByRole("button", { name: "Action" });
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({ minHeight: 44, backgroundColor });
  expect(StyleSheet.flatten(screen.getByText("Action").props.style).color).toBe(color);
  fireEvent.press(button);
  expect(press).toHaveBeenCalledTimes(1);
});

test("default buttons keep their outline; quiet buttons still respect disabled state", () => {
  const press = jest.fn();
  const screen = render(<>
    <Button label="Default" onPress={press} />
    <Button label="Quiet" variant="quiet" disabled onPress={press} />
  </>);
  expect(StyleSheet.flatten(screen.getByLabelText("Default").props.style)).toMatchObject({ borderWidth: 1, borderColor: Colors.border });
  expect(screen.getByLabelText("Quiet").props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByLabelText("Quiet"));
  expect(press).not.toHaveBeenCalled();
});

test("content width is opt-in, centered and responsive without changing the scroll owner", () => {
  const screen = render(<Screen><Text>Page</Text></Screen>);
  expect(StyleSheet.flatten(screen.getByTestId("screen-content").props.style).maxWidth).toBeUndefined();
  expect(screen.getAllByTestId("screen-scroll")).toHaveLength(1);
  screen.rerender(<Screen contentWidth={960}><Text>Page</Text></Screen>);
  expect(StyleSheet.flatten(screen.getByTestId("screen-content").props.style)).toMatchObject({ maxWidth: 960, width: "100%", alignSelf: "center" });
  expect(screen.getAllByTestId("screen-scroll")).toHaveLength(1);
  screen.rerender(<Screen contentWidth={960} scroll={false}><Text>Page</Text></Screen>);
  expect(screen.queryByTestId("screen-scroll")).toBeNull();
  expect(StyleSheet.flatten(screen.getByTestId("screen-content").props.style)).toMatchObject({ flex: 1, minHeight: 0, maxWidth: 960 });
});

test("segmented controls keep full-size touch targets and selected state", () => {
  const change = jest.fn();
  const screen = render(<SegmentedControl value="day" onChange={change} options={[{ value: "day", label: "Day" }, { value: "calendar", label: "Calendar" }]} />);
  expect(StyleSheet.flatten(screen.getByLabelText("Calendar").props.style).minHeight).toBe(44);
  expect(screen.getByLabelText("Day").props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByLabelText("Calendar"));
  expect(change).toHaveBeenCalledWith("calendar");
});
