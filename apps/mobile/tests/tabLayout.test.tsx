import { BottomTabBarHeightCallbackContext, BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { fireEvent, render } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { AdaptiveTabBar } from "@/components/AdaptiveTabBar";

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useLinkBuilder: () => (name: string) => `/${name}`,
  Link: jest.requireActual("react-native").Text
}));

afterEach(() => jest.restoreAllMocks());

function props() {
  const routes = ["index", "week", "grocery", "recipes", "profile"].map(name => ({ key: name, name }));
  const navigation = { emit: jest.fn().mockReturnValue({ defaultPrevented: false }), dispatch: jest.fn() };
  return {
    state: { key: "tabs", index: 0, routes },
    descriptors: Object.fromEntries(routes.map((route, index) => [route.key, { options: { title: ["Discover", "This Week", "Grocery", "Recipes", "Profile"][index] } }])),
    navigation, insets: { top: 20, bottom: 24, left: 0, right: 0 }
  };
}

test("native navigation wraps enlarged labels, reports its height and retains safe-area spacing", () => {
  jest.spyOn(ReactNative, "useWindowDimensions").mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
  const height = jest.fn();
  const screen = render(<BottomTabBarHeightCallbackContext.Provider value={height}><AdaptiveTabBar {...props() as unknown as BottomTabBarProps} /></BottomTabBarHeightCallbackContext.Provider>);
  expect(ReactNative.StyleSheet.flatten(screen.getByTestId("main-tab-bar").props.style)).toMatchObject({ flexWrap: "wrap", paddingBottom: 24 });
  expect(ReactNative.StyleSheet.flatten(screen.getByLabelText("This Week").props.style).minWidth).toBe(128);
  fireEvent(screen.getByTestId("main-tab-bar"), "layout", { nativeEvent: { layout: { height: 168 } } });
  expect(height).toHaveBeenCalledWith(168);
  expect(screen.getByText("This Week").props.numberOfLines).toBeUndefined();
});

test("web navigation uses whole-label intrinsic width and keeps all five destinations", () => {
  jest.replaceProperty(ReactNative.Platform, "OS", "web");
  const screen = render(<AdaptiveTabBar {...props() as unknown as BottomTabBarProps} />);
  expect(ReactNative.StyleSheet.flatten(screen.getByLabelText("This Week").props.style).minWidth).toBe("max-content");
  for (const label of ["Discover", "This Week", "Grocery", "Recipes", "Profile"]) expect(screen.getByLabelText(label)).toBeTruthy();
});

test("tab selection retains navigation events, selected state and cancellation", () => {
  const tabProps = props();
  const screen = render(<AdaptiveTabBar {...tabProps as unknown as BottomTabBarProps} />);
  expect(screen.getByLabelText("Discover").props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByLabelText("This Week"));
  expect(tabProps.navigation.emit).toHaveBeenCalledWith({ type: "tabPress", target: "week", canPreventDefault: true });
  expect(tabProps.navigation.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "NAVIGATE", target: "tabs", payload: { name: "week", merge: true } }));
  tabProps.navigation.dispatch.mockClear();
  tabProps.navigation.emit.mockReturnValue({ defaultPrevented: true });
  fireEvent.press(screen.getByLabelText("Recipes"));
  expect(tabProps.navigation.dispatch).not.toHaveBeenCalled();
});
