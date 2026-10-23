import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Animated, Modal, Platform, StyleSheet, Text } from "react-native";
import { BottomSheetModal } from "@/components/BottomSheetModal";
import { WorkoutSheet } from "@/features/workouts/ui";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
type Completion = (result: { finished: boolean }) => void;
type Motion = { value: Animated.Value; target: number; complete?: Completion; stop: jest.Mock };
const motions: Motion[] = [];
let onMotionPreference: (value: boolean) => void;
const removeListener = jest.fn();
const sheetStyle = { width: "100%" as const, maxHeight: "80%" as const, backgroundColor: "white" };

function snapshot(screen: ReturnType<typeof render>, id: string) {
  return StyleSheet.flatten(screen.getByTestId(id, { includeHiddenElements: true }).props.style);
}
function finish(motion: Motion) {
  act(() => { motion.value.setValue(motion.target); motion.complete?.({ finished: true }); });
}
function panel(visible = true, onClose = jest.fn()) {
  return <BottomSheetModal visible={visible} sheetStyle={sheetStyle} onRequestClose={onClose}><Text>Sheet content</Text></BottomSheetModal>;
}

beforeEach(() => {
  motions.length = 0; removeListener.mockClear();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  const subscribe = (_: string, listener: (value: boolean) => void) => {
    onMotionPreference = listener;
    return { remove: removeListener };
  };
  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(subscribe as unknown as typeof AccessibilityInfo.addEventListener);
  jest.spyOn(Animated, "timing").mockImplementation((value, config) => {
    const motion: Motion = { value: value as Animated.Value, target: Number(config.toValue), stop: jest.fn() };
    motions.push(motion);
    return { start: callback => { motion.complete = callback; }, stop: motion.stop, reset: jest.fn() };
  });
});
afterEach(() => jest.restoreAllMocks());

test("only the panel translates while the full-screen backdrop changes opacity", async () => {
  const screen = render(panel());
  try {
    await waitFor(() => expect(motions).toHaveLength(1));
    expect(screen.UNSAFE_getByType(Modal).props.animationType).toBe("none");
    expect(snapshot(screen, "bottom-sheet-container").transform).toBeUndefined();
    expect(snapshot(screen, "bottom-sheet-backdrop")).toMatchObject({ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 });
    expect(snapshot(screen, "bottom-sheet-backdrop").transform).toBeUndefined();
    act(() => motions[0].value.setValue(0.5));
    expect(snapshot(screen, "bottom-sheet-backdrop").opacity).toBe(0.5);
    expect(snapshot(screen, "bottom-sheet-panel").transform[0].translateY).toBeGreaterThan(0);
    expect(snapshot(screen, "bottom-sheet-panel").backgroundColor).toBe("white");
    finish(motions[0]);
    expect(snapshot(screen, "bottom-sheet-backdrop").opacity).toBe(1);
    expect(snapshot(screen, "bottom-sheet-panel").transform[0].translateY).toBe(0);
    expect(jest.mocked(Animated.timing).mock.calls[0][1].useNativeDriver).toBe(Platform.OS !== "web");
  } finally { screen.unmount(); }
});

test("closing hides actions from accessibility immediately, then removes the modal after animation", async () => {
  const close = jest.fn(), screen = render(panel(true, close));
  try {
    await waitFor(() => expect(motions).toHaveLength(1)); finish(motions[0]);
    fireEvent(screen.getByTestId("bottom-sheet-modal"), "requestClose");
    expect(close).toHaveBeenCalledTimes(1);
    screen.rerender(panel(false, close));
    expect(screen.queryByText("Sheet content")).toBeNull();
    expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(true);
    expect(motions.at(-1)!.target).toBe(0);
    finish(motions.at(-1)!);
    expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(false);
  } finally { screen.unmount(); }
});

test("a stale close completion cannot hide a quickly reopened sheet", async () => {
  const screen = render(panel());
  try {
    await waitFor(() => expect(motions).toHaveLength(1)); finish(motions[0]);
    screen.rerender(panel(false));
    const closing = motions.at(-1)!;
    screen.rerender(panel(true));
    expect(closing.stop).toHaveBeenCalled();
    act(() => closing.complete?.({ finished: true }));
    finish(motions.at(-1)!);
    expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(true);
    expect(screen.getByText("Sheet content")).toBeTruthy();
  } finally { screen.unmount(); }
});

test("reduced motion skips both animations and closes without a timer", async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
  const screen = render(panel());
  try {
    await waitFor(() => expect(snapshot(screen, "bottom-sheet-backdrop").opacity).toBe(1));
    expect(motions).toHaveLength(0);
    expect(snapshot(screen, "bottom-sheet-panel").transform[0].translateY).toBe(0);
    screen.rerender(panel(false));
    expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(false);
  } finally { screen.unmount(); }
});

test("a new motion preference takes priority over an older async preference result", async () => {
  let resolve!: (value: boolean) => void;
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockImplementation(() => new Promise(done => { resolve = done; }));
  const screen = render(panel());
  try {
    await waitFor(() => expect(resolve).toBeDefined());
    act(() => onMotionPreference(true));
    await act(async () => resolve(false));
    expect(motions).toHaveLength(0);
    expect(snapshot(screen, "bottom-sheet-panel").transform[0].translateY).toBe(0);
  } finally { screen.unmount(); }
});

test("preference lookup failure uses a non-animated, usable sheet", async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockRejectedValue(new Error("Unavailable"));
  const screen = render(panel());
  try {
    await waitFor(() => expect(snapshot(screen, "bottom-sheet-backdrop").opacity).toBe(1));
    expect(motions).toHaveLength(0);
  } finally { screen.unmount(); }
});

test("unmount removes the preference listener and stops active motion", async () => {
  const screen = render(panel());
  await waitFor(() => expect(motions).toHaveLength(1));
  screen.unmount();
  expect(removeListener).toHaveBeenCalledTimes(1);
  expect(motions[0].stop).toHaveBeenCalled();
});

test("workout sheets still prevent back dismissal and close taps while saving", async () => {
  const close = jest.fn();
  const content = (busy: boolean) => <WorkoutSheet title="Log performance" busy={busy} onClose={close}><Text>Workout fields</Text></WorkoutSheet>;
  const screen = render(content(true));
  try {
    await waitFor(() => expect(motions).toHaveLength(1));
    fireEvent(screen.getByTestId("bottom-sheet-modal"), "requestClose");
    fireEvent.press(screen.getByLabelText("Close Log performance"));
    expect(close).not.toHaveBeenCalled();
    screen.rerender(content(false));
    fireEvent(screen.getByTestId("bottom-sheet-modal"), "requestClose");
    expect(close).toHaveBeenCalledTimes(1);
  } finally { screen.unmount(); }
});
