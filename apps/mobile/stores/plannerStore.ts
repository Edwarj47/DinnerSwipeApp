import { create } from "zustand";

import { Recipe } from "@/services/types";

type SwipeAction = { recipe: Recipe; action: "add" | "skip" | "favorite" | "hide" };

type PlannerState = {
  sessionId: string;
  selectedRecipes: Recipe[];
  history: SwipeAction[];
  offlineQueue: SwipeAction[];
  addSwipe: (action: SwipeAction) => void;
  undo: () => SwipeAction | undefined;
};

export const usePlannerStore = create<PlannerState>((set, get) => ({
  sessionId: Math.random().toString(36).slice(2),
  selectedRecipes: [],
  history: [],
  offlineQueue: [],
  addSwipe: (action) =>
    set((state) => ({
      history: [...state.history, action],
      selectedRecipes: action.action === "add" ? [...state.selectedRecipes, action.recipe] : state.selectedRecipes,
      offlineQueue: [...state.offlineQueue, action]
    })),
  undo: () => {
    const history = get().history;
    const last = history[history.length - 1];
    if (!last) return undefined;
    set((state) => ({
      history: state.history.slice(0, -1),
      selectedRecipes:
        last.action === "add"
          ? state.selectedRecipes.filter((recipe) => recipe.id !== last.recipe.id)
          : state.selectedRecipes,
      offlineQueue: state.offlineQueue.slice(0, -1)
    }));
    return last;
  }
}));

