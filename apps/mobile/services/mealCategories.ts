export type MealLabel = "breakfast" | "lunch" | "dinner" | "snack" | "beverage";

export const MEAL_LABEL_OPTIONS: { label: string; value: MealLabel }[] = [
  { label: "Breakfast", value: "breakfast" },
  { label: "Lunch", value: "lunch" },
  { label: "Dinner", value: "dinner" },
  { label: "Snack", value: "snack" },
  { label: "Beverages", value: "beverage" }
];

const RECIPE_CATEGORY_OPTIONS: { label: string; value: string }[] = [
  ...MEAL_LABEL_OPTIONS, { label: "Dessert", value: "dessert" }, { label: "Sauce", value: "sauce" }
];

export function normalizeRecipeCategory(value: string | null | undefined): string {
  const text = value?.trim() || "dinner";
  const key = text.toLowerCase();
  if (["beverage", "beverages", "drink", "drinks"].includes(key)) return "beverage";
  return RECIPE_CATEGORY_OPTIONS.some(option => option.value === key) ? key : text;
}

export function normalizeMealLabel(value: string | null | undefined): MealLabel {
  const category = normalizeRecipeCategory(value);
  return MEAL_LABEL_OPTIONS.find(option => option.value === category)?.value ?? "dinner";
}

export function recipeCategoryOptions(value: string) {
  return RECIPE_CATEGORY_OPTIONS.some(option => option.value === value)
    ? RECIPE_CATEGORY_OPTIONS : [...RECIPE_CATEGORY_OPTIONS, { label: value, value }];
}
