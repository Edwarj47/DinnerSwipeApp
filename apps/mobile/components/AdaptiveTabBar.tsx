import { BottomTabBarHeightCallbackContext, BottomTabBarProps } from "expo-router/js-tabs";
import { Link, Href } from "expo-router";
import { useLinkBuilder } from "expo-router/react-navigation";
import { useContext } from "react";
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, ViewStyle } from "react-native";
import { useThemeColors, useThemedStyles, ThemeColors } from "./theme";

export function AdaptiveTabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const styles = useThemedStyles(createStyles);
  const Colors = useThemeColors();
  const { fontScale } = useWindowDimensions();
  const { buildHref } = useLinkBuilder();
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);
  const sizing: ViewStyle = { minWidth: Platform.OS === "web" ? "max-content" as ViewStyle["minWidth"] : 64 * fontScale };
  return <View testID="main-tab-bar" role={Platform.OS === "web" ? "navigation" : undefined} accessibilityRole="tablist" onLayout={event => reportHeight?.(event.nativeEvent.layout.height)}
    style={[styles.bar, { paddingBottom: Math.max(10, insets.bottom), paddingLeft: insets.left, paddingRight: insets.right }]}>
    {state.routes.map((route, index) => {
      const options = descriptors[route.key].options;
      const focused = state.index === index;
      const label = typeof options.tabBarLabel === "string" ? options.tabBarLabel : options.title ?? route.name;
      const color = focused ? Colors.accent : Colors.muted;
      const select = () => {
        const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (!focused && !event.defaultPrevented) navigateToTab(route.key);
      };
      const content = <><View style={styles.icon}>{options.tabBarIcon?.({ focused, color, size: 25 })}</View><Text style={[styles.label, { color }]}>{label}</Text></>;
      const shared = { accessibilityLabel: options.tabBarAccessibilityLabel ?? label, accessibilityState: { selected: focused }, testID: options.tabBarButtonTestID, style: [styles.tab, sizing] };
      const to = buildHref(route.name, route.params);
      return Platform.OS === "web" && to ? <Link key={route.key} {...shared} aria-current={focused ? "page" : undefined} href={to as Href} onPress={event => {
        if ("button" in event && (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)) return;
        event.preventDefault(); select();
      }}>{content}</Link> : <Pressable key={route.key} {...shared} accessibilityRole={Platform.OS === "ios" ? "button" : "tab"} onPress={select}
        onLongPress={() => emitter.emit({ type: "tabLongPress", target: route.key })}>{content}</Pressable>;
    })}
  </View>;
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  bar: { flexDirection: "row", flexWrap: "wrap", minHeight: 64, paddingTop: 2, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  tab: { flexBasis: 0, flexGrow: 1, minHeight: 44, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingHorizontal: 4, paddingVertical: 4 },
  icon: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 12, lineHeight: 16, textAlign: "center" }
});
