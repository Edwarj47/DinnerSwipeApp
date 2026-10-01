import { create } from "zustand";

import { Recipe } from "@/services/types";

type SwipeAction = { recipe: Recipe; action: "add" | "skip" | "favorite" | "hide"; requestId?: string };

type PlannerState = {
  sessionId: string;
  selectedRecipes: Recipe[];
  history: SwipeAction[];
  offlineQueue: SwipeAction[];
  shuffleVersion: number;
  weekStart: string | null;
  syncWeek: (weekStart: string) => void;
  removeChoice: (requestId: string) => void;
  addSwipe: (action: SwipeAction) => string;
  undo: () => SwipeAction | undefined;
  resetSession: () => void;
  returnToDiscover: (recipeIds: string[]) => void;
  restartDiscover: () => void;
  restoreRecipe: (recipeId: string) => void;
};

export const usePlannerStore = create<PlannerState>((set, get) => ({
  sessionId: Math.random().toString(36).slice(2),
  selectedRecipes: [],
  history: [],
  offlineQueue: [],
  shuffleVersion: 0,
  weekStart: null,
  resetSession: () => set({ sessionId: Math.random().toString(36).slice(2), weekStart: null, selectedRecipes: [], history: [], offlineQueue: [] }),
  syncWeek: (weekStart) => {
    if (get().weekStart === weekStart) return;
    if (get().weekStart !== null) get().resetSession();
    set({ weekStart });
  },
  removeChoice: (requestId) => set(state => ({
    history: state.history.filter(item => item.requestId !== requestId),
    selectedRecipes: state.history.filter(item => item.requestId !== requestId && item.action === "add").map(item => item.recipe),
    offlineQueue: state.offlineQueue.filter(item => item.requestId !== requestId)
  })),
  returnToDiscover: (recipeIds) => set(state => ({
    history: state.history.filter(item => item.action === "hide" || !recipeIds.includes(item.recipe.id)),
    selectedRecipes: state.selectedRecipes.filter(recipe => !recipeIds.includes(recipe.id)),
    offlineQueue: state.offlineQueue.filter(item => !recipeIds.includes(item.recipe.id)),
    shuffleVersion: state.shuffleVersion + 1
  })),
  restartDiscover: () => set(state => ({ history: state.history.filter(item => item.action === "hide"), shuffleVersion: state.shuffleVersion + 1 })),
  restoreRecipe: (recipeId) => set(state => ({
    history: state.history.filter(item => item.recipe.id !== recipeId),
    offlineQueue: state.offlineQueue.filter(item => item.recipe.id !== recipeId),
    shuffleVersion: state.shuffleVersion + 1
  })),
  addSwipe: (action) => {
    const requestId = action.requestId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const choice = { ...action, requestId };
    set((state) => ({
      history: [...state.history, choice],
      selectedRecipes: action.action === "add" ? [...state.selectedRecipes, action.recipe] : state.selectedRecipes,
      offlineQueue: [...state.offlineQueue, choice]
    }));
    return requestId;
  },
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
