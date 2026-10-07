import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { ReactNode, useCallback, useContext, useRef } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors } from "@/components/theme";
import { OfflineStatusBar } from "@/components/OfflineStatusBar";
import { revealTourTarget, TourScrollContext, useGuidedTour } from "@/features/onboarding/TourContext";

type Props = {
  children: ReactNode;
  scroll?: boolean;
  contentWidth?: number;
  onViewportLayout?: (height: number) => void;
};

export function Screen({ children, scroll = true, contentWidth, onViewportLayout }: Props) {
  const tour = useGuidedTour();
  const tabBarHeight = useContext(BottomTabBarHeightContext);
  const contentRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const canScroll = scroll;
  const reveal = useCallback((node: View) => revealTourTarget(node, contentRef.current, scrollRef.current), []);
  const content = <View ref={contentRef} testID="screen-content" collapsable={false} onLayout={!canScroll && onViewportLayout ? event => onViewportLayout(event.nativeEvent.layout.height) : undefined} style={[styles.content, tabBarHeight !== undefined && { paddingBottom: 16 }, contentWidth !== undefined && { width: "100%", maxWidth: contentWidth, alignSelf: "center" }, !canScroll && { flex: 1, minHeight: 0, paddingBottom: 12 }]}>{children}</View>;
  return (
    <TourScrollContext.Provider value={reveal}>
      <SafeAreaView style={styles.root} edges={tabBarHeight !== undefined ? tour ? ["left", "right"] : ["top", "left", "right"] : tour ? ["left", "right", "bottom"] : undefined}>
        <OfflineStatusBar />
        {canScroll ? <ScrollView ref={scrollRef} testID="screen-scroll" onLayout={onViewportLayout ? event => onViewportLayout(event.nativeEvent.layout.height) : undefined} style={styles.scroll} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={Platform.OS === "web"} keyboardShouldPersistTaps="handled">{content}</ScrollView> : content}
      </SafeAreaView>
    </TourScrollContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: Colors.background },
  scroll: { flex: 1, minHeight: 0 },
  content: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 96 }
});
