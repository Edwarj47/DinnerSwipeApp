import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, type AudioRecorder } from "expo-audio";
import { File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
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
  const [recorderSession, setRecorderSession] = useState(() => Crypto.randomUUID());
  const alive = useRef(true), epoch = useRef(0), starting = useRef(false);
  const phase = useRef<"idle" | "permission" | "preparing" | "recording" | "stopping" | "done">("idle");
  const clip = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cleanup = useRef<Promise<void>>(Promise.resolve());
  const finishing = useRef<Promise<void>>(Promise.resolve());
  const capture = useRef<{ uri: string; started: number; session: string; recorder: AudioRecorder } | null>(null);
  const pendingRecorder = useRef<{ session: string; resolve: (recorder: AudioRecorder | null) => void } | null>(null);
  const permissionWait = useRef<() => void>(() => undefined);
  const finishRef = useRef<() => Promise<void>>(async () => undefined);
  const failureRef = useRef<() => void>(() => undefined);
  // A native recorder per take binds even Android's metadata-free errors to the right session.
  const recorder = useAudioRecorder({ ...OPTIONS, fileName: recorderSession }, status => {
    if (!capture.current || capture.current.session !== recorderSession) return;
    if (status.id && status.id !== capture.current.recorder.id) return;
    if (status.url && status.url !== capture.current.uri) return;
    if (status.hasError || status.mediaServicesDidReset) failureRef.current();
    else if (status.isFinished && status.url === capture.current.uri) void finishRef.current();
  });
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  const supported = Platform.OS === "android" || Platform.OS === "ios";

  const clear = useCallback(() => {
    epoch.current++; phase.current = "idle";
    permissionWait.current();
    pendingRecorder.current?.resolve(null); pendingRecorder.current = null;
    clearTimeout(timer.current);
    const saved = clip.current; clip.current = null;
    const activeRecorder = recorderRef.current;
    let active: string | null = null;
    try { active = activeRecorder.uri; } catch { /* Native object may have been released on unmount. */ }
    capture.current = null;
    if (alive.current) { setRecording(false); setPreparing(false); setAudio(null); setError(""); }
    // Serialize microphone shutdown with the next start, including rapid close/reopen.
    cleanup.current = cleanup.current.catch(() => undefined).then(async () => {
      await finishing.current;
      try { if (activeRecorder.getStatus().isRecording || activeRecorder.getStatus().canRecord) await activeRecorder.stop(); } catch { /* Already stopped or released. */ }
      removeClip(saved); removeClip(active);
      try { await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }); } catch { /* Recorder may already be released. */ }
    });
  }, []);

  useEffect(() => {
    if (pendingRecorder.current?.session !== recorderSession) return;
    pendingRecorder.current.resolve(recorder); pendingRecorder.current = null;
  }, [recorder, recorderSession]);

  failureRef.current = () => {
    clear(); if (alive.current) setError("Recording was interrupted. Record again or type your meal.");
  };
  finishRef.current = () => {
    if (phase.current !== "recording" || !capture.current) return Promise.resolve();
    phase.current = "stopping"; clearTimeout(timer.current);
    const generation = epoch.current;
    const session = capture.current;
    const task = (async () => {
    try {
      const status = session.recorder.getStatus();
      const duration = Math.max(status.durationMillis, Date.now() - session.started);
      if (status.isRecording || status.canRecord) await session.recorder.stop();
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
      if (AppState.currentState === "inactive" || AppState.currentState === "background") {
        await new Promise<void>(resolve => {
          const listener = AppState.addEventListener("change", state => { if (state === "active") done(); });
          const timeout = setTimeout(() => {
            clear();
            if (alive.current) setError("Return to the app and tap Record meal again.");
          }, 10000);
          const done = () => { clearTimeout(timeout); listener.remove(); permissionWait.current = () => undefined; resolve(); };
          permissionWait.current = done;
        });
      }
      if (!current()) return;
      if (AppState.currentState && AppState.currentState !== "active") { clear(); return; }
      phase.current = "preparing";
      const session = Crypto.randomUUID();
      const activeRecorder = await new Promise<AudioRecorder | null>(resolve => {
        pendingRecorder.current = { session, resolve }; setRecorderSession(session);
      });
      if (!current() || !activeRecorder) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false });
      if (!current()) return;
      await activeRecorder.prepareToRecordAsync();
      const uri = activeRecorder.uri;
      if (!current()) {
        try { await activeRecorder.stop(); } catch { /* Preparation may have been cancelled. */ }
        removeClip(uri); return;
      }
      if (!uri?.startsWith(Paths.cache.uri)) throw new Error("No private recording available");
      capture.current = { uri, started: Date.now(), recorder: activeRecorder, session };
      phase.current = "recording";
      activeRecorder.record({ forDuration: MAX_MEAL_RECORDING_SECONDS });
      setRecording(true);
      timer.current = setTimeout(() => { void finishRef.current(); }, MAX_MEAL_RECORDING_SECONDS * 1000);
    } catch {
      if (current()) { clear(); setError("Microphone unavailable. Try again or type your meal."); }
    } finally {
      starting.current = false;
      if (current()) setPreparing(false);
    }
  }, [clear, supported]);

  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener("change", state => {
      // Android permission dialogs pause the host Activity. No microphone is active yet.
      if (phase.current !== "permission" && (state === "background" || state === "inactive")) clear();
    });
    return () => { alive.current = false; clear(); listener.remove(); };
  }, [clear]);
  return { supported, recording, preparing, audio, error, start, stop, clear };
}
