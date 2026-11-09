import { create } from "zustand";
import { AccentColor, DEFAULT_ACCENT } from "./appearancePalette";

type State = {
  owner: string | null; accent: AccentColor; savedAccent: AccentColor; ready: boolean;
  pending: boolean; error: string; iconError: string;
};
// Rendering the palette must not initialize networking or native icon APIs.
export const useAppearance = create<State>(() => ({ owner: null, accent: DEFAULT_ACCENT, savedAccent: DEFAULT_ACCENT, ready: false, pending: false, error: "", iconError: "" }));
