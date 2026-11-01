import { BottomTabBarHeightCallbackContext, BottomTabBarProps } from "expo-router/js-tabs";
import { fireEvent, render } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { AdaptiveTabBar } from "@/components/AdaptiveTabBar";

jest.mock("expo-router/react-navigation", () => ({
  useLinkBuilder: () => ({ buildHref: (name: string) => `/${name}` })
}));
jest.mock("expo-router", () => ({
  Link: jest.requireActual("react-native").Text
}));

afterEach(() => jest.restoreAllMocks());

function props() {
  const routes = ["index", "week", "grocery", "recipes", "profile"].map(name => ({ key: name, name }));
  const emitter = { emit: jest.fn().mockReturnValue({ defaultPrevented: false }) };
  return {
    state: { key: "tabs", index: 0, routes },
    descriptors: Object.fromEntries(routes.map((route, index) => [route.key, { options: { title: ["Discover", "This Week", "Grocery", "Recipes", "Profile"][index] } }])),
    emitter, navigateToTab: jest.fn(), insets: { top: 20, bottom: 24, left: 0, right: 0 }
  };
}

test("native navigation wraps enlarged labels, reports its height and retains safe-area spacing", () => {
  jest.spyOn(ReactNative, "useWindowDimensions").mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
  const height = jest.fn();
  const screen = render(<BottomTabBarHeightCallbackContext.Provider value={height}><AdaptiveTabBar {...props() as unknown as BottomTabBarProps} /></BottomTabBarHeightCallbackContext.Provider>);
  expect(ReactNative.StyleSheet.flatten(screen.getByTestId("main-tab-bar").props.style)).toMatchObject({ flexWrap: "wrap", paddingBottom: 24 });
  expect(screen.getByTestId("main-tab-bar").props.role).toBeUndefined();
  expect(ReactNative.StyleSheet.flatten(screen.getByLabelText("This Week").props.style).minWidth).toBe(128);
  fireEvent(screen.getByTestId("main-tab-bar"), "layout", { nativeEvent: { layout: { height: 168 } } });
  expect(height).toHaveBeenCalledWith(168);
  expect(screen.getByText("This Week").props.numberOfLines).toBeUndefined();
});

test("web navigation uses whole-label intrinsic width and keeps all five destinations", () => {
  jest.replaceProperty(ReactNative.Platform, "OS", "web");
  const screen = render(<AdaptiveTabBar {...props() as unknown as BottomTabBarProps} />);
  expect(ReactNative.StyleSheet.flatten(screen.getByLabelText("This Week").props.style).minWidth).toBe("max-content");
  expect(screen.getByTestId("main-tab-bar").props.role).toBe("navigation");
  expect(screen.getByLabelText("Discover").props["aria-current"]).toBe("page");
  expect(screen.getByLabelText("This Week").props["aria-current"]).toBeUndefined();
  for (const label of ["Discover", "This Week", "Grocery", "Recipes", "Profile"]) expect(screen.getByLabelText(label)).toBeTruthy();
});

test("tab selection retains navigation events, selected state and cancellation", () => {
  const tabProps = props();
  const screen = render(<AdaptiveTabBar {...tabProps as unknown as BottomTabBarProps} />);
  expect(screen.getByLabelText("Discover").props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByLabelText("This Week"));
  expect(tabProps.emitter.emit).toHaveBeenCalledWith({ type: "tabPress", target: "week", canPreventDefault: true });
  expect(tabProps.navigateToTab).toHaveBeenCalledWith("week");
  tabProps.navigateToTab.mockClear();
  tabProps.emitter.emit.mockReturnValue({ defaultPrevented: true });
  fireEvent.press(screen.getByLabelText("Recipes"));
  expect(tabProps.navigateToTab).not.toHaveBeenCalled();
});
