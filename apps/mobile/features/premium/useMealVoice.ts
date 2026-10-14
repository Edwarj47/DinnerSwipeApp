export function useMealVoice() {
  return { supported: false, recording: false, audio: null as Blob | null, error: "",
    start: async () => undefined, stop: () => undefined, clear: () => undefined };
}
