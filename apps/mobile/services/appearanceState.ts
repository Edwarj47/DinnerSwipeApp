import { create } from "zustand";
import { AccentColor } from "./appearancePalette";

type State = {
  owner: string | null; accent: AccentColor; savedAccent: AccentColor; ready: boolean;
  pending: boolean; error: string; iconError: string;
};
// Rendering the palette must not initialize networking or native icon APIs.
export const useAppearance = create<State>(() => ({ owner: null, accent: "red", savedAccent: "red", ready: false, pending: false, error: "", iconError: "" }));
