export const MAX_MEAL_AUDIO_BYTES = 6 * 1024 * 1024;
export const MAX_MEAL_RECORDING_SECONDS = 59;

export type NativeMealAudio = { uri: string; name: string; type: "audio/mp4"; size: number };
export type MealAudio = Blob | NativeMealAudio;
export type MealVoice = {
  supported: boolean; recording: boolean; preparing?: boolean; audio: MealAudio | null; error: string;
  start: () => Promise<void>; stop: () => void; clear: () => void;
};

export function appendMealAudio(body: FormData, audio: MealAudio) {
  if (!(audio.size > 0) || audio.size > MAX_MEAL_AUDIO_BYTES) throw new Error("Record up to 60 seconds and 6 MB.");
  if ("uri" in audio) {
    if (!audio.uri.startsWith("file://") || audio.type !== "audio/mp4") throw new Error("Record your meal again.");
    // React Native FormData streams this app-owned cache file; it is not a browser Blob.
    body.append("audio", { uri: audio.uri, name: "meal-recording.m4a", type: audio.type } as unknown as Blob);
  } else {
    body.append("audio", audio, "meal-recording");
  }
}
