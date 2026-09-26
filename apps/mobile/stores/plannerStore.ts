import { create } from "zustand";

import { Recipe } from "@/services/types";

type SwipeAction = { recipe: Recipe; action: "add" | "skip" | "favorite" | "hide" };

type PlannerState = {
  sessionId: string;
  selectedRecipes: Recipe[];
  history: SwipeAction[];
  offlineQueue: SwipeAction[];
  shuffleVersion: number;
  addSwipe: (action: SwipeAction) => void;
  undo: () => SwipeAction | undefined;
  resetSession: () => void;
  returnToDiscover: (recipeIds: string[]) => void;
  restartDiscover: () => void;
};

export const usePlannerStore = create<PlannerState>((set, get) => ({
  sessionId: Math.random().toString(36).slice(2),
  selectedRecipes: [],
  history: [],
  offlineQueue: [],
  shuffleVersion: 0,
  resetSession: () => set({ sessionId: Math.random().toString(36).slice(2), selectedRecipes: [], history: [], offlineQueue: [] }),
  returnToDiscover: (recipeIds) => set(state => ({
    history: state.history.filter(item => item.action === "hide" || !recipeIds.includes(item.recipe.id)),
    selectedRecipes: state.selectedRecipes.filter(recipe => !recipeIds.includes(recipe.id)),
    offlineQueue: state.offlineQueue.filter(item => !recipeIds.includes(item.recipe.id)),
    shuffleVersion: state.shuffleVersion + 1
  })),
  restartDiscover: () => set(state => ({ history: state.history.filter(item => item.action === "hide"), shuffleVersion: state.shuffleVersion + 1 })),
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
