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

