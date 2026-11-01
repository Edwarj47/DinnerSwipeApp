import { act, renderHook } from "@testing-library/react-native";
import { AppState, AppStateStatus, Platform } from "react-native";
import { useMealVoice } from "@/features/premium/useMealVoice";
import { appendMealAudio, MAX_MEAL_AUDIO_BYTES } from "@/features/premium/mealVoiceAudio";

let mockIsRecording = false, mockPrepared = false, mockUri: string | null = null, mockDuration = 1000;
const mockFiles = new Map<string, number>();
const mockRequestPermission = jest.fn(async () => ({ granted: true }));
const mockAudioMode = jest.fn(async () => undefined);
let mockStatus: (status: { hasError: boolean; isFinished: boolean; url?: string | null; mediaServicesDidReset?: boolean }) => void;
const mockRecorder = {
  get uri() { return mockUri; },
  getStatus: jest.fn(() => ({ isRecording: mockIsRecording, canRecord: mockPrepared, durationMillis: mockDuration })),
  prepareToRecordAsync: jest.fn(async () => { mockPrepared = true; mockUri = "file:///cache/Audio/meal.m4a"; mockFiles.set(mockUri, 1024); }),
  record: jest.fn(() => { mockIsRecording = true; }),
  stop: jest.fn(async () => { mockIsRecording = false; mockPrepared = false; mockDuration = 0; })
};
const mockDelete = jest.fn((uri: string) => { mockFiles.delete(uri); });
jest.mock("expo-audio", () => ({
  AudioModule: { requestRecordingPermissionsAsync: () => mockRequestPermission() },
  RecordingPresets: { HIGH_QUALITY: { extension: ".m4a", android: {}, ios: {} } },
  setAudioModeAsync: (...args: unknown[]) => mockAudioMode(...args as []),
  useAudioRecorder: (_options: unknown, listener: typeof mockStatus) => { mockStatus = listener; return mockRecorder; }
}));
jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache/" } },
  File: class {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri) ?? 0; }
    delete() { mockDelete(this.uri); }
  }
}));
const listeners = new Set<(state: AppStateStatus) => void>();
const originalState = Object.getOwnPropertyDescriptor(AppState, "currentState")!;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockFiles.clear(); listeners.clear();
  mockIsRecording = false; mockPrepared = false; mockUri = null; mockDuration = 1000;
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockRecorder.prepareToRecordAsync.mockImplementation(async () => {
    mockPrepared = true; mockUri = "file:///cache/Audio/meal.m4a"; mockFiles.set(mockUri, 1024);
  });
  jest.replaceProperty(Platform, "OS", "android");
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    listeners.add(listener); return { remove: () => listeners.delete(listener) };
  });
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); Object.defineProperty(AppState, "currentState", originalState); });
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

test("records bounded mono AAC, prepares once and releases the microphone before providing a native upload", async () => {
  const hook = renderHook(useMealVoice);
  try {
    await act(async () => { await hook.result.current.start(); });
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockRecorder.record).toHaveBeenCalledWith({ forDuration: 59 });
    expect(hook.result.current.recording).toBe(true);
    await act(async () => { hook.result.current.stop(); await flush(); });
    expect(hook.result.current.recording).toBe(false);
    expect(hook.result.current.audio).toEqual({ uri: mockUri, size: 1024, type: "audio/mp4", name: "meal-recording.m4a" });
    expect(mockAudioMode).toHaveBeenLastCalledWith({ allowsRecording: false, allowsBackgroundRecording: false });
    const append = jest.fn(); appendMealAudio({ append } as unknown as FormData, hook.result.current.audio!);
    expect(append).toHaveBeenCalledWith("audio", { uri: mockUri, name: "meal-recording.m4a", type: "audio/mp4" });
    await act(async () => { hook.result.current.clear(); await flush(); });
    expect(mockFiles.size).toBe(0); expect(hook.result.current.audio).toBeNull();
  } finally { hook.unmount(); }
});

test("permission denial never records and leaves typed meal assistance available", async () => {
  mockRequestPermission.mockResolvedValue({ granted: false });
  const hook = renderHook(useMealVoice);
  try {
    await act(async () => { await hook.result.current.start(); });
    expect(mockRecorder.record).not.toHaveBeenCalled();
    expect(hook.result.current.error).toContain("Microphone permission");
    expect(hook.result.current.preparing).toBe(false);
  } finally { hook.unmount(); }
});

test("rapid duplicate starts request permission only once", async () => {
  const hook = renderHook(useMealVoice);
  try {
    await act(async () => { await Promise.all([hook.result.current.start(), hook.result.current.start()]); });
    expect(mockRequestPermission).toHaveBeenCalledTimes(1); expect(mockRecorder.record).toHaveBeenCalledTimes(1);
  } finally { hook.unmount(); }
});

test("native duration completion and JS timer cannot produce two completed clips", async () => {
  const hook = renderHook(useMealVoice);
  try {
    await act(async () => { await hook.result.current.start(); });
    await act(async () => { mockIsRecording = false; mockStatus({ hasError: false, isFinished: true, url: mockUri }); await flush(); });
    const clip = hook.result.current.audio;
    await act(async () => { await jest.advanceTimersByTimeAsync(60000); });
    expect(clip).toBeTruthy(); expect(hook.result.current.audio).toBe(clip);
  } finally { hook.unmount(); }
});

test("backgrounding discards the clip and prevents publishing an in-flight stop", async () => {
  let stopped!: () => void;
  mockRecorder.stop.mockImplementationOnce(() => new Promise<void>(resolve => { stopped = resolve; }));
  const hook = renderHook(useMealVoice);
  try {
    await act(async () => { await hook.result.current.start(); });
    act(() => hook.result.current.stop());
    await act(async () => { listeners.forEach(fn => fn("background")); stopped(); mockIsRecording = false; await flush(); });
    expect(hook.result.current.audio).toBeNull(); expect(mockFiles.size).toBe(0);
  } finally { hook.unmount(); }
});

test("closing during native preparation cannot start a microphone later", async () => {
  let prepared!: () => void;
  mockRecorder.prepareToRecordAsync.mockImplementationOnce(() => new Promise<void>(resolve => {
    prepared = () => { mockUri = "file:///cache/Audio/late.m4a"; mockFiles.set(mockUri, 128); resolve(); };
  }));
  const hook = renderHook(useMealVoice);
  let start!: Promise<void>;
  await act(async () => { start = hook.result.current.start(); await flush(); });
  hook.unmount();
  await act(async () => { prepared(); await start; await flush(); });
  expect(mockRecorder.record).not.toHaveBeenCalled(); expect(mockFiles.size).toBe(0);
});

test.each([0, MAX_MEAL_AUDIO_BYTES + 1])("invalid audio size %s is discarded without an upload", async size => {
  const hook = renderHook(useMealVoice);
  try {
    await act(async () => { await hook.result.current.start(); });
    mockFiles.set(mockUri!, size);
    await act(async () => { hook.result.current.stop(); await flush(); });
    expect(hook.result.current.audio).toBeNull(); expect(hook.result.current.error).toContain("No usable audio");
    expect(mockFiles.size).toBe(0);
  } finally { hook.unmount(); }
});

test("oversized, empty and remote URI upload descriptors fail closed", () => {
  const append = jest.fn(), body = { append } as unknown as FormData;
  for (const audio of [new Blob([]), new Blob([new Uint8Array(MAX_MEAL_AUDIO_BYTES + 1)]),
    { uri: "https://example.com/audio.m4a", name: "meal.m4a", type: "audio/mp4" as const, size: 100 }]) {
    expect(() => appendMealAudio(body, audio)).toThrow();
  }
  expect(append).not.toHaveBeenCalled();
});

test("late completion from an older URI cannot finalize a replacement recording", async () => {
  const hook = renderHook(useMealVoice);
  try {
    await act(async () => { await hook.result.current.start(); });
    const old = mockUri;
    await act(async () => { hook.result.current.clear(); await flush(); });
    mockRecorder.prepareToRecordAsync.mockImplementationOnce(async () => { mockPrepared = true; mockUri = "file:///cache/Audio/new.m4a"; mockFiles.set(mockUri, 1024); });
    await act(async () => { await hook.result.current.start(); });
    await act(async () => { mockStatus({ hasError: false, isFinished: true, url: old }); await flush(); });
    expect(hook.result.current.recording).toBe(true); expect(hook.result.current.audio).toBeNull();
    await act(async () => { hook.result.current.stop(); await flush(); });
    expect(hook.result.current.audio).toMatchObject({ uri: mockUri });
  } finally { hook.unmount(); }
});

test("system-paused recordings are finalized and pre-stop duration is enforced", async () => {
  const hook = renderHook(useMealVoice);
  try {
    await act(async () => { await hook.result.current.start(); });
    mockIsRecording = false; mockDuration = 61000;
    await act(async () => { hook.result.current.stop(); await flush(); });
    expect(mockRecorder.stop).toHaveBeenCalled(); expect(hook.result.current.audio).toBeNull();
    expect(hook.result.current.error).toContain("No usable audio");
  } finally { hook.unmount(); }
});

test("permission grant waits for iOS foreground restoration without recording behind the prompt", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "inactive" });
  const hook = renderHook(useMealVoice);
  try {
    let pending!: Promise<void>;
    await act(async () => { pending = hook.result.current.start(); await flush(); });
    expect(mockRecorder.record).not.toHaveBeenCalled();
    await act(async () => {
      Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
      listeners.forEach(fn => fn("active")); await pending;
    });
    expect(hook.result.current.recording).toBe(true);
  } finally { hook.unmount(); }
});
