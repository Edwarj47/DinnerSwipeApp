import { useCallback, useEffect, useRef, useState } from "react";

export function useMealVoice() {
  const [recording, setRecording] = useState(false);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const epoch = useRef(0);
  const supported = typeof window !== "undefined" && window.isSecureContext &&
    typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const stop = useCallback(() => { if (recorder.current?.state === "recording") recorder.current.stop(); }, []);
  const clear = useCallback(() => {
    epoch.current++;
    stop(); stream.current?.getTracks().forEach(track => track.stop());
    clearTimeout(timer.current); recorder.current = null; stream.current = null;
    setRecording(false); setAudio(null); setError("");
  }, [stop]);
  async function start() {
    clear(); const generation = epoch.current;
    try {
      const capture = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== epoch.current) { capture.getTracks().forEach(track => track.stop()); return; }
      stream.current = capture;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(value => MediaRecorder.isTypeSupported(value));
      if (!mime) throw new Error("This browser cannot record audio. Type your meal instead.");
      const active = new MediaRecorder(capture, { mimeType: mime, audioBitsPerSecond: 64000 });
      recorder.current = active;
      let size = 0; const chunks: Blob[] = [];
      active.ondataavailable = event => {
        size += event.data.size;
        if (size > 6 * 1024 * 1024) { clear(); setError("Recording exceeded 6 MB. Try a shorter clip."); return; }
        chunks.push(event.data);
      };
      active.onerror = () => { clear(); setError("Recording failed. Try typing your meal."); };
      active.onstop = () => {
        clearTimeout(timer.current); capture.getTracks().forEach(track => track.stop());
        if (generation !== epoch.current) return;
        recorder.current = null; stream.current = null;
        const audio = new Blob(chunks, { type: active.mimeType.split(";")[0] });
        setRecording(false);
        if (audio.size) setAudio(audio); else setError("No audio recorded. Try again.");
      };
      active.start(1000); setRecording(true); timer.current = setTimeout(stop, 59000);
    } catch (reason) { clear(); setError(reason instanceof Error ? reason.message : "Microphone unavailable."); }
  }
  useEffect(() => {
    const background = () => { if (document.hidden) clear(); };
    document.addEventListener("visibilitychange", background);
    return () => { document.removeEventListener("visibilitychange", background); clear(); };
  }, [clear]);
  return { supported, recording, audio, error, start, stop, clear };
}
