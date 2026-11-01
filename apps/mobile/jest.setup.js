jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("@react-native-community/netinfo", () =>
  require("@react-native-community/netinfo/jest/netinfo-mock"));
jest.mock("expo-crypto", () => {
  let sequence = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` };
});
jest.mock("expo-audio", () => {
  const recorder = { uri: null, getStatus: () => ({ isRecording: false, canRecord: false, durationMillis: 0 }),
    prepareToRecordAsync: jest.fn(), record: jest.fn(), stop: jest.fn(async () => undefined) };
  return { AudioModule: { requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: false })) },
    RecordingPresets: { HIGH_QUALITY: {} }, setAudioModeAsync: jest.fn(async () => undefined), useAudioRecorder: () => recorder };
});
jest.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { WEEKLY: "weekly", CALENDAR: "calendar" },
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve("dinner-weekly-reset")),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  clearLastNotificationResponseAsync: jest.fn(() => Promise.resolve())
}));
jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
require("react-native-gesture-handler/jestSetup");
jest.mock("react-native-gesture-handler/src/handlers/gestures/installUIRuntimeBindings", () => ({ installUIRuntimeBindings: jest.fn() }));
require("react-native-reanimated").setUpTests();
require("@tanstack/react-query").notifyManager.setScheduler(queueMicrotask);
