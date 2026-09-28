import { usePlannerStore } from "@/stores/plannerStore";

const recipe = {
  id: "r1",
  name: "Chicken quesadillas",
  servings: 4,
  difficulty: "easy",
  meal_type: "dinner",
  source_type: "manual",
  validation_status: "approved",
  validation_warnings: [],
  duplicate_status: "new",
  image_status: "validated",
  ingredients: [],
  instructions: [],
  tags: [],
  is_favorite: false,
  is_hidden: false
};

test("records swipe and undo restores local selection", () => {
  usePlannerStore.setState({ selectedRecipes: [], history: [], offlineQueue: [] });
  usePlannerStore.getState().addSwipe({ recipe, action: "add" });
  expect(usePlannerStore.getState().selectedRecipes).toHaveLength(1);
  const undone = usePlannerStore.getState().undo();
  expect(undone?.action).toBe("add");
  expect(usePlannerStore.getState().selectedRecipes).toHaveLength(0);
});

test("reset returns only affected meals, preserves hidden choices, and reshuffles", () => {
  usePlannerStore.getState().resetSession();
  const store = usePlannerStore.getState();
  store.addSwipe({ recipe, action: "add" });
  store.addSwipe({ recipe: { ...recipe, id: "other-day" }, action: "add" });
  store.addSwipe({ recipe: { ...recipe, id: "hidden" }, action: "hide" });
  const revision = usePlannerStore.getState().shuffleVersion;
  store.returnToDiscover([recipe.id, "hidden"]);
  expect(usePlannerStore.getState().history.map(item => item.recipe.id)).toEqual(["other-day", "hidden"]);
  expect(usePlannerStore.getState().selectedRecipes.map(item => item.id)).toEqual(["other-day"]);
  expect(usePlannerStore.getState().shuffleVersion).toBe(revision + 1);
  store.restartDiscover();
  expect(usePlannerStore.getState().history.map(item => item.action)).toEqual(["hide"]);
});

test("only a new week clears swipe history and starts a new shuffled session", () => {
  const store = usePlannerStore.getState();
  store.resetSession();
  store.syncWeek("2026-09-28");
  store.addSwipe({ recipe, action: "favorite" });
  const firstSession = usePlannerStore.getState().sessionId;
  store.syncWeek("2026-09-28");
  expect(usePlannerStore.getState().history).toHaveLength(1);
  expect(usePlannerStore.getState().sessionId).toBe(firstSession);
  store.syncWeek("2026-10-05");
  expect(usePlannerStore.getState().history).toHaveLength(0);
  expect(usePlannerStore.getState().sessionId).not.toBe(firstSession);
});

test("a failed hide returns to the deck without dropping other choices", () => {
  const store = usePlannerStore.getState();
  store.resetSession();
  const requestId = store.addSwipe({ recipe, action: "hide" });
  store.addSwipe({ recipe: { ...recipe, id: "second" }, action: "skip" });
  store.removeChoice(requestId);
  expect(usePlannerStore.getState().history.map(choice => choice.recipe.id)).toEqual(["second"]);
});
