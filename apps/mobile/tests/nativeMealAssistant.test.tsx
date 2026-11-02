import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AppState, AppStateStatus, Platform } from "react-native";
import { Platform as ExpoPlatform } from "expo";
import { MealAssistant } from "@/features/premium/MealAssistant";
import { apiFetch } from "@/services/api";
import { useOfflineStatus } from "@/services/offlineStore";

// Keep the installed Expo recorder hook and shared-object lifecycle; replace only native hardware.
jest.unmock("expo-audio");
const mockFiles = new Map<string, number>();
const mockInstances: MockRecorder[] = [];
const mockPermission = jest.fn<Promise<{ granted: boolean }>, []>();
class MockRecorder {
  readonly id = `recorder-${mockInstances.length}`;
  readonly options: Record<string, unknown>;
  uri = "";
  isRecording = false;
  prepared = false;
  released = false;
  private listeners = new Set<(value: Record<string, unknown>) => void>();
  constructor(options: Record<string, unknown>) { this.options = options; mockInstances.push(this); }
  addListener(_name: string, listener: (value: Record<string, unknown>) => void) { this.listeners.add(listener); return { remove: () => this.listeners.delete(listener) }; }
  async prepareToRecordAsync() { this.prepared = true; this.uri = `file:///data/user/0/dev.dcss.dinnerswipe/cache/Audio/${this.id}.m4a`; mockFiles.set(this.uri, 1024); }
  record(options: { forDuration: number }) {
    if (AppState.currentState !== "active" || options.forDuration !== 59 || !this.prepared || this.released) throw Error("Invalid native recording startup");
    this.isRecording = true;
  }
  getStatus() { return { isRecording: this.isRecording, canRecord: this.prepared, durationMillis: this.isRecording ? 1000 : 0 }; }
  async stop() { this.isRecording = false; this.prepared = false; }
  release() { this.released = true; this.isRecording = false; this.prepared = false; }
  emit(changes: Record<string, unknown>) { this.listeners.forEach(fn => fn({ id: this.id, url: null, isFinished: false, hasError: false, ...changes })); }
  emitRaw(payload: Record<string, unknown>) { this.listeners.forEach(fn => fn(payload)); }
  queuedError() {
    const listeners = [...this.listeners];
    return () => listeners.forEach(fn => fn({ hasError: true, isFinished: true, url: null }));
  }
}
jest.mock("expo-audio/build/AudioModule", () => ({
  __esModule: true,
  default: {
    AudioPlayer: class { replace() {} setPlaybackRate() {} },
    AudioRecorder: function (options: Record<string, unknown>) { return new MockRecorder(options); },
    requestRecordingPermissionsAsync: () => mockPermission(),
    setAudioModeAsync: jest.fn(async () => undefined)
  }
}));
jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///data/user/0/dev.dcss.dinnerswipe/cache/" } },
  File: class {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri) ?? 0; }
    delete() { mockFiles.delete(this.uri); }
  }
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn(), ApiError: class extends Error {} }));
const request = jest.mocked(apiFetch);
const latest = () => mockInstances.at(-1)!;
const listeners = new Set<(state: AppStateStatus) => void>();
const originalState = Object.getOwnPropertyDescriptor(AppState, "currentState")!;
function state(value: AppStateStatus) {
  Object.defineProperty(AppState, "currentState", { configurable: true, value }); listeners.forEach(fn => fn(value));
}
beforeEach(() => {
  jest.clearAllMocks(); mockFiles.clear(); mockInstances.length = 0; listeners.clear();
  jest.replaceProperty(Platform, "OS", "android"); jest.replaceProperty(ExpoPlatform, "OS", "android"); state("active");
  useOfflineStatus.setState({ offline: false });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; });
  mockPermission.mockReset().mockResolvedValue({ granted: true });
  request.mockReset().mockImplementation(async path => {
    if (path.endsWith("/consent")) return { accepted: true, terms_version: "test" };
    if (path.endsWith("/transcriptions")) return { text: "four eggs" };
    throw Error(`Unexpected request: ${path}`);
  });
});
afterEach(() => { jest.restoreAllMocks(); Object.defineProperty(AppState, "currentState", originalState); });
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const saved = jest.fn();
  const element = () => <QueryClientProvider client={client}><MealAssistant voiceEnabled onClose={jest.fn()} onSaved={saved} /></QueryClientProvider>;
  const screen = render(element()); await screen.findByLabelText("Record meal");
  return { ...screen, saved, rerenderAssistant: () => screen.rerender(element()), close: () => { screen.unmount(); client.clear(); } };
}

test.each(["active-before-grant", "grant-before-active"])("Android permission pause survives both real hooks and assistant listeners: %s", async order => {
  let grant!: (permission: { granted: boolean }) => void;
  mockPermission.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
  const screen = await mount();
  try {
    fireEvent.press(screen.getByLabelText("Record meal"));
    await waitFor(() => expect(mockPermission).toHaveBeenCalledTimes(1));
    act(() => state("background"));
    expect(latest().isRecording).toBe(false);
    if (order === "grant-before-active") await act(async () => { grant({ granted: true }); await Promise.resolve(); });
    expect(latest().isRecording).toBe(false);
    await act(async () => { state("active"); if (order === "active-before-grant") grant({ granted: true }); });
    await screen.findByLabelText("Stop recording");
    expect(mockInstances).toHaveLength(2); expect(mockInstances[0].released).toBe(true);
    expect(latest().options).toMatchObject({ directory: "cache", extension: ".m4a", numberOfChannels: 1, bitRate: 64000, outputFormat: "mpeg4", audioEncoder: "aac" });
    screen.rerenderAssistant(); expect(latest().isRecording).toBe(true); expect(mockInstances).toHaveLength(2);
    fireEvent.press(screen.getByLabelText("Stop recording"));
    await waitFor(() => expect(screen.getByLabelText("Meal description").props.value).toBe("four eggs"));
    expect(latest().isRecording).toBe(false); expect(mockFiles.size).toBe(0);
    const uploads = request.mock.calls.filter(([path]) => path.endsWith("/transcriptions"));
    expect(uploads).toHaveLength(1);
    expect(screen.saved).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([path]) => /drafts|calculations|macros\/entries/.test(path))).toBe(false);
  } finally { screen.close(); }
});

test("leaving an actual recording still releases the microphone and never transcribes", async () => {
  const screen = await mount();
  try {
    fireEvent.press(screen.getByLabelText("Record meal")); await screen.findByLabelText("Stop recording");
    await act(async () => { state("background"); });
    await waitFor(() => expect(mockFiles.size).toBe(0));
    expect(latest().isRecording).toBe(false);
    expect(request.mock.calls.some(([path]) => path.endsWith("/transcriptions"))).toBe(false);
    act(() => state("active")); await screen.findByLabelText("Record meal");
  } finally { screen.close(); }
});

test("native hardware failure without an event URL is visible and leaves typed entry usable", async () => {
  const screen = await mount();
  try {
    fireEvent.changeText(screen.getByLabelText("Meal description"), "My lunch");
    fireEvent.press(screen.getByLabelText("Record meal")); await screen.findByLabelText("Stop recording");
    await act(async () => { latest().emitRaw({ hasError: true, url: null, error: "Microphone unavailable" }); });
    await screen.findByText("Recording was interrupted. Record again or type your meal.");
    expect(latest().isRecording).toBe(false); expect(mockFiles.size).toBe(0);
    expect(screen.getByLabelText("Meal description").props.value).toBe("My lunch");
    expect(request.mock.calls.some(([path]) => path.endsWith("/transcriptions"))).toBe(false);
  } finally { screen.close(); }
});

test("an already queued metadata-free error from a released take cannot cancel the next recording", async () => {
  const screen = await mount();
  try {
    fireEvent.press(screen.getByLabelText("Record meal")); await screen.findByLabelText("Stop recording");
    const old = latest(), queued = old.queuedError();
    await act(async () => { state("background"); });
    await waitFor(() => expect(mockFiles.size).toBe(0));
    act(() => state("active"));
    fireEvent.press(screen.getByLabelText("Record meal")); await screen.findByLabelText("Stop recording");
    const current = latest();
    expect(current).not.toBe(old); expect(old.released).toBe(true);
    await act(async () => { queued(); });
    expect(current.isRecording).toBe(true); expect(mockFiles.has(current.uri)).toBe(true);
    expect(screen.queryByText(/Recording was interrupted/)).toBeNull();
    expect(request.mock.calls.some(([path]) => path.endsWith("/transcriptions"))).toBe(false);
  } finally { screen.close(); }
});
