import { createContext, useContext } from "react";
import { ScrollViewInstance, ViewInstance } from "react-native";
import { TourStep } from "./tourSteps";

export type GuidedTour = {
  step: TourStep; index: number; total: number; visit: number; expanded: boolean;
  expand: () => void; collapse: () => void; next: () => void; skipSection: () => void;
};
export const TourContext = createContext<GuidedTour | null>(null);
export const useGuidedTour = () => useContext(TourContext);
export const TourScrollContext = createContext<((node: ViewInstance) => void) | null>(null);
export function revealTourTarget(node: ViewInstance, content: ViewInstance | null, scroll: ScrollViewInstance | null) {
  if (!content || !scroll) return;
  node.measureLayout(content, (_x, y) => scroll.scrollTo({ y: Math.max(0, y - 12), animated: false }), () => {});
}
