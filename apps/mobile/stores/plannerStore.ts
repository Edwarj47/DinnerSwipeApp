import { create } from "zustand";

import { Recipe } from "@/services/types";

type SwipeAction = { recipe: Recipe; action: "add" | "skip" | "favorite" | "hide"; requestId?: string };
type PlannerContext = { sessionId: string; history: SwipeAction[]; selectedRecipes: Recipe[]; offlineQueue: SwipeAction[]; shuffleVersion: number };

type PlannerState = {
  contexts: Record<string, PlannerContext>;
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
  returnToDiscover: (recipeIds: string[], context?: string) => void;
  restartDiscover: () => void;
  restoreRecipe: (recipeId: string) => void;
};

export const usePlannerStore = create<PlannerState>((set, get) => ({
  contexts: {},
  sessionId: Math.random().toString(36).slice(2),
  selectedRecipes: [],
  history: [],
  offlineQueue: [],
  shuffleVersion: 0,
  weekStart: null,
  resetSession: () => set({ contexts: {}, sessionId: Math.random().toString(36).slice(2), weekStart: null, selectedRecipes: [], history: [], offlineQueue: [] }),
  syncWeek: (weekStart) => {
    if (get().weekStart === weekStart) return;
    const state = get();
    const contexts = { ...state.contexts };
    if (state.weekStart) contexts[state.weekStart] = { sessionId: state.sessionId, history: state.history, selectedRecipes: state.selectedRecipes, offlineQueue: state.offlineQueue, shuffleVersion: state.shuffleVersion };
    // Each kitchen/week retains its own deck. Limit memory to recent contexts.
    while (Object.keys(contexts).length > 20) delete contexts[Object.keys(contexts)[0]];
    const restored = contexts[weekStart] ?? { sessionId: Math.random().toString(36).slice(2), history: [], selectedRecipes: [], offlineQueue: [], shuffleVersion: 0 };
    set({ ...restored, contexts, weekStart });
  },
  removeChoice: (requestId) => set(state => ({
    contexts: Object.fromEntries(Object.entries(state.contexts).map(([key, value]) => [key, { ...value, history: value.history.filter(item => item.requestId !== requestId), selectedRecipes: value.history.filter(item => item.requestId !== requestId && item.action === "add").map(item => item.recipe), offlineQueue: value.offlineQueue.filter(item => item.requestId !== requestId) }])),
    history: state.history.filter(item => item.requestId !== requestId),
    selectedRecipes: state.history.filter(item => item.requestId !== requestId && item.action === "add").map(item => item.recipe),
    offlineQueue: state.offlineQueue.filter(item => item.requestId !== requestId)
  })),
  returnToDiscover: (recipeIds, context) => set(state => {
    const returned = (value: PlannerContext) => ({
      history: value.history.filter(item => item.action === "hide" || !recipeIds.includes(item.recipe.id)),
      selectedRecipes: value.selectedRecipes.filter(recipe => !recipeIds.includes(recipe.id)),
      offlineQueue: value.offlineQueue.filter(item => !recipeIds.includes(item.recipe.id)),
      shuffleVersion: value.shuffleVersion + 1
    });
    if (!context || context === state.weekStart) return returned(state);
    const previous = state.contexts[context];
    return previous ? { contexts: { ...state.contexts, [context]: { ...previous, ...returned(previous) } } } : {};
  }),
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
