import { BottomTabBarHeightCallbackContext, BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { CommonActions, Link, useLinkBuilder } from "@react-navigation/native";
import { useContext } from "react";
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, ViewStyle } from "react-native";
import { Colors } from "./theme";

export function AdaptiveTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { fontScale } = useWindowDimensions();
  const buildLink = useLinkBuilder();
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);
  const sizing: ViewStyle = { minWidth: Platform.OS === "web" ? "max-content" as ViewStyle["minWidth"] : 64 * fontScale };
  return <View testID="main-tab-bar" accessibilityRole="tablist" onLayout={event => reportHeight?.(event.nativeEvent.layout.height)}
    style={[styles.bar, { paddingBottom: Math.max(10, insets.bottom), paddingLeft: insets.left, paddingRight: insets.right }]}>
    {state.routes.map((route, index) => {
      const options = descriptors[route.key].options;
      const focused = state.index === index;
      const label = typeof options.tabBarLabel === "string" ? options.tabBarLabel : options.title ?? route.name;
      const color = focused ? Colors.tomato : Colors.muted;
      const select = () => {
        const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (!focused && !event.defaultPrevented) navigation.dispatch({ ...CommonActions.navigate({ name: route.name, merge: true }), target: state.key });
      };
      const content = <><View style={styles.icon}>{options.tabBarIcon?.({ focused, color, size: 25 })}</View><Text style={[styles.label, { color }]}>{label}</Text></>;
      const shared = { accessibilityLabel: options.tabBarAccessibilityLabel ?? label, accessibilityState: { selected: focused }, testID: options.tabBarTestID, style: [styles.tab, sizing] };
      const to = buildLink(route.name, route.params);
      return Platform.OS === "web" && to ? <Link key={route.key} {...shared} to={to} onPress={event => {
        if ("button" in event && (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)) return;
        event.preventDefault(); select();
      }}>{content}</Link> : <Pressable key={route.key} {...shared} accessibilityRole={Platform.OS === "ios" ? "button" : "tab"} onPress={select}
        onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}>{content}</Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", flexWrap: "wrap", minHeight: 64, paddingTop: 2, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  tab: { flexBasis: 0, flexGrow: 1, minHeight: 44, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingHorizontal: 4, paddingVertical: 4 },
  icon: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 12, lineHeight: 16, textAlign: "center" }
});
