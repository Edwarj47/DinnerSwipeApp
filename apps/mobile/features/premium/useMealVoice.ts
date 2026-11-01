import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { MAX_MEAL_AUDIO_BYTES, MAX_MEAL_RECORDING_SECONDS, MealVoice, NativeMealAudio } from "./mealVoiceAudio";

const OPTIONS = { ...RecordingPresets.HIGH_QUALITY, directory: "cache" as const, numberOfChannels: 1, bitRate: 64000 };

function removeClip(uri: string | null | undefined) {
  if (!uri?.startsWith(Paths.cache.uri)) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Cache eviction is also controlled by the OS. */ }
}

export function useMealVoice(): MealVoice {
  const [recording, setRecording] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [audio, setAudio] = useState<NativeMealAudio | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true), epoch = useRef(0), starting = useRef(false);
  const phase = useRef<"idle" | "permission" | "preparing" | "recording" | "stopping" | "done">("idle");
  const clip = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cleanup = useRef<Promise<void>>(Promise.resolve());
  const finishing = useRef<Promise<void>>(Promise.resolve());
  const capture = useRef<{ uri: string; started: number } | null>(null);
  const permissionWait = useRef<() => void>(() => undefined);
  const finishRef = useRef<() => Promise<void>>(async () => undefined);
  const failureRef = useRef<() => void>(() => undefined);
  const recorder = useAudioRecorder(OPTIONS, status => {
    if (!capture.current || status.url !== capture.current.uri) return;
    if (status.hasError || status.mediaServicesDidReset) failureRef.current();
    else if (status.isFinished) void finishRef.current();
  });
  const supported = Platform.OS === "android" || Platform.OS === "ios";

  const clear = useCallback(() => {
    epoch.current++; phase.current = "idle";
    permissionWait.current();
    clearTimeout(timer.current);
    const saved = clip.current; clip.current = null;
    let active: string | null = null;
    try { active = recorder.uri; } catch { /* Native object may have been released on unmount. */ }
    capture.current = null;
    if (alive.current) { setRecording(false); setPreparing(false); setAudio(null); setError(""); }
    // Serialize microphone shutdown with the next start, including rapid close/reopen.
    cleanup.current = cleanup.current.catch(() => undefined).then(async () => {
      await finishing.current;
      try { if (recorder.getStatus().isRecording || recorder.getStatus().canRecord) await recorder.stop(); } catch { /* Already stopped or released. */ }
      removeClip(saved); removeClip(active);
      try { await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }); } catch { /* Recorder may already be released. */ }
    });
  }, [recorder]);

  failureRef.current = () => {
    clear(); if (alive.current) setError("Recording was interrupted. Record again or type your meal.");
  };
  finishRef.current = () => {
    if (phase.current !== "recording" || !capture.current) return Promise.resolve();
    phase.current = "stopping"; clearTimeout(timer.current);
    const generation = epoch.current;
    const session = capture.current;
    const duration = Math.max(recorder.getStatus().durationMillis, Date.now() - session.started);
    const task = (async () => {
    try {
      const status = recorder.getStatus();
      if (status.isRecording || status.canRecord) await recorder.stop();
      const uri = session.uri;
      if (generation !== epoch.current || !alive.current) { removeClip(uri); return; }
      if (!uri?.startsWith(Paths.cache.uri)) throw new Error("No private recording available");
      const file = new File(uri), size = file.size;
      if (!file.exists || !(size > 0) || size > MAX_MEAL_AUDIO_BYTES || duration > 60000) throw new Error("Invalid recording");
      clip.current = uri; phase.current = "done";
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
      if (generation !== epoch.current || !alive.current) { removeClip(uri); return; }
      setRecording(false); setAudio({ uri, size, type: "audio/mp4", name: "meal-recording.m4a" });
    } catch {
      if (generation === epoch.current && alive.current) {
        clear(); setError("No usable audio recorded. Try a shorter recording or type your meal.");
      }
    }
    })();
    finishing.current = task;
    return task;
  };
  const stop = useCallback(() => {
    if (phase.current === "permission" || phase.current === "preparing") clear();
    else void finishRef.current();
  }, [clear]);

  const start = useCallback(async () => {
    if (!supported || starting.current || !["idle", "done"].includes(phase.current)) return;
    starting.current = true; clear();
    const generation = epoch.current;
    const current = () => generation === epoch.current && alive.current;
    try {
      await cleanup.current;
      if (!current()) return;
      phase.current = "permission"; setPreparing(true);
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!current()) return;
      if (!permission.granted) {
        phase.current = "idle"; setError("Microphone permission is needed to record. You can type your meal instead."); return;
      }
      if (AppState.currentState === "inactive") {
        await new Promise<void>(resolve => {
          const listener = AppState.addEventListener("change", state => { if (state !== "inactive") done(); });
          const timeout = setTimeout(() => { clear(); done(); }, 10000);
          const done = () => { clearTimeout(timeout); listener.remove(); permissionWait.current = () => undefined; resolve(); };
          permissionWait.current = done;
        });
      }
      if (!current()) return;
      if (AppState.currentState && AppState.currentState !== "active") { clear(); return; }
      phase.current = "preparing";
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false });
      if (!current()) return;
      await recorder.prepareToRecordAsync();
      const uri = recorder.uri;
      if (!current()) {
        try { await recorder.stop(); } catch { /* Preparation may have been cancelled. */ }
        removeClip(uri); return;
      }
      if (!uri?.startsWith(Paths.cache.uri)) throw new Error("No private recording available");
      capture.current = { uri, started: Date.now() };
      phase.current = "recording";
      recorder.record({ forDuration: MAX_MEAL_RECORDING_SECONDS });
      setRecording(true);
      timer.current = setTimeout(() => { void finishRef.current(); }, MAX_MEAL_RECORDING_SECONDS * 1000);
    } catch {
      if (current()) { clear(); setError("Microphone unavailable. Try again or type your meal."); }
    } finally {
      starting.current = false;
      if (current()) setPreparing(false);
    }
  }, [clear, recorder, supported]);

  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener("change", state => {
      if (state === "background" || (state === "inactive" && phase.current !== "permission")) clear();
    });
    return () => { alive.current = false; clear(); listener.remove(); };
  }, [clear]);
  return { supported, recording, preparing, audio, error, start, stop, clear };
}
