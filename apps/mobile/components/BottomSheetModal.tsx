import { ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, Platform, StyleProp, StyleSheet, useWindowDimensions, View, ViewStyle } from "react-native";

type Props = {
  children: ReactNode;
  visible?: boolean;
  onRequestClose: () => void;
  sheetStyle: StyleProp<ViewStyle>;
  backdropColor?: string;
};

export function BottomSheetModal({ children, visible = true, onRequestClose, sheetStyle, backdropColor = "rgba(0,0,0,0.4)" }: Props) {
  const { height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const [present, setPresent] = useState(visible);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true, changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", value => {
      changed = true;
      if (active) setReduceMotion(value);
    });
    void Promise.resolve().then(() => AccessibilityInfo.isReduceMotionEnabled()).then(value => {
      if (active && !changed) setReduceMotion(Boolean(value));
    }).catch(() => { if (active && !changed) setReduceMotion(true); });
    return () => { active = false; subscription?.remove(); };
  }, []);

  useEffect(() => {
    let current = true;
    if (visible) setPresent(true);
    if (reduceMotion == null) {
      if (!visible) setPresent(false);
      return;
    }
    if (reduceMotion) {
      progress.setValue(visible ? 1 : 0);
      if (!visible) setPresent(false);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 240 : 180,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== "web"
    });
    animation.start(({ finished }) => {
      // A cancelled closing animation must not dismiss a reopened sheet.
      if (current && finished && !visible) setPresent(false);
    });
    return () => { current = false; animation.stop(); };
  }, [visible, reduceMotion, progress]);

  return <Modal testID="bottom-sheet-modal" visible={visible || present} transparent animationType="none"
    onRequestClose={() => { if (visible) onRequestClose(); }}>
    <View testID="bottom-sheet-container" style={styles.container} pointerEvents={visible ? "auto" : "none"}
      accessibilityElementsHidden={!visible} importantForAccessibility={visible ? "auto" : "no-hide-descendants"}>
      <Animated.View testID="bottom-sheet-backdrop" pointerEvents="none" importantForAccessibility="no"
        style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor, opacity: progress }]} />
      <Animated.View testID="bottom-sheet-panel" accessibilityViewIsModal
        style={[sheetStyle, { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }] }]}>
        {children}
      </Animated.View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "flex-end", alignItems: "center" }
});
