import { fireEvent, render } from "@testing-library/react-native";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import * as ReactNative from "react-native";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { SettingsContext } from "@/features/settings/SettingsContext";
import { addSettingsListener } from "@/services/settingsMenu";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@/components/OfflineStatusBar", () => ({ OfflineStatusBar: () => null }));

test("settings stays in the fixed header outside scrolling content", () => {
  const open = jest.fn();
  const remove = addSettingsListener(open);
  const screen = render(<SettingsContext.Provider value={{ open: false, close: jest.fn(), invitePremium: jest.fn() }}>
    <Screen header={<Text>Recipes</Text>}><Text>Library</Text></Screen>
  </SettingsContext.Provider>);
  try {
    const button = screen.getByLabelText("Open settings");
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ width: 44, height: 44, borderRadius: 22 });
    expect(screen.getByTestId("screen-scroll").findAll((node: { props: { accessibilityLabel?: string } }) => node.props.accessibilityLabel === "Open settings")).toHaveLength(0);
    fireEvent.press(button);
    expect(open).toHaveBeenCalledWith({});
  } finally { remove(); screen.unmount(); }
});

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

test("tab screens use compact footer spacing while public screens retain their safe area", () => {
  const screen = render(<Screen><Text>Page</Text></Screen>);
  expect(StyleSheet.flatten(screen.getByTestId("screen-content").props.style).paddingBottom).toBe(96);
  screen.unmount();
  const tab = render(<BottomTabBarHeightContext.Provider value={64}><Screen><Text>Page</Text></Screen></BottomTabBarHeightContext.Provider>);
  expect(StyleSheet.flatten(tab.getByTestId("screen-content").props.style).paddingBottom).toBe(16);
  expect(tab.UNSAFE_getAllByType(View).find(node => node.props.edges)?.props.edges).toEqual(["top", "left", "right"]);
});

test("viewport measurements use the scroll owner or the non-scrolling content", () => {
  const measured = jest.fn();
  const screen = render(<Screen onViewportLayout={measured}><Text>Page</Text></Screen>);
  fireEvent(screen.getByTestId("screen-scroll"), "layout", { nativeEvent: { layout: { height: 600, width: 320 } } });
  expect(measured).toHaveBeenLastCalledWith(600);
  screen.rerender(<Screen scroll={false} onViewportLayout={measured}><Text>Page</Text></Screen>);
  fireEvent(screen.getByTestId("screen-content"), "layout", { nativeEvent: { layout: { height: 560, width: 320 } } });
  expect(measured).toHaveBeenLastCalledWith(560);
});

test("adaptive segments wrap enlarged labels without shrinking touch targets", () => {
  const dimensions = jest.spyOn(ReactNative, "useWindowDimensions").mockReturnValue({ width: 320, height: 720, scale: 1, fontScale: 2 });
  try {
    const change = jest.fn();
    const screen = render(<SegmentedControl adaptive value="day" onChange={change} options={[
      { value: "day", label: "Day" }, { value: "grid", label: "Grid" },
      { value: "calendar", label: "Calendar" }, { value: "trends", label: "Trends" }
    ]} />);
    const calendar = StyleSheet.flatten(screen.getByLabelText("Calendar").props.style);
    expect(calendar.minHeight).toBe(44);
    expect(calendar.flexBasis).toBeGreaterThanOrEqual(140);
    expect(calendar.flexBasis).toBeLessThan(284);
    fireEvent.press(screen.getByLabelText("Calendar"));
    expect(change).toHaveBeenCalledWith("calendar");
  } finally { dimensions.mockRestore(); }
});
