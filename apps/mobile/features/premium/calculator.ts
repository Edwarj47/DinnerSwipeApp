import { RecipeNutrition } from "@/services/types";
import { MealLabel } from "@/services/mealCategories";
import { NUTRIENTS } from "@/features/recipes/recipeNutrition";

export type CalculatorItem = {
  source: "manual" | "fatsecret"; name: string; portions: number;
  food_id?: string; serving_id?: string; nutrition?: RecipeNutrition;
};
export type CalculatorRow = CalculatorItem & { key: string; values: RecipeNutrition; expires?: number; servingLabel?: string };
export type Calculation = {
  id: string; recipe_id?: string | null; entry_id?: string | null; name: string;
  meal_label: MealLabel; meal_date?: string | null; servings: number; items: CalculatorItem[];
  resolved_items: RecipeNutrition[]; totals: RecipeNutrition;
  serving_labels?: (string | null)[];
  temporary_nutrition: boolean; nutrition_unavailable: boolean;
};
export const PROVIDER_VIEW_MS = 15 * 60 * 1000;

export function calculationTotal(rows: CalculatorRow[], now = Date.now()): RecipeNutrition {
  return Object.fromEntries(NUTRIENTS.map(([field]) => [field,
    rows.some(row => row.values[field] == null || (row.expires != null && row.expires <= now)) ? null :
      Math.round(rows.reduce((sum, row) => sum + (row.values[field] ?? 0) * row.portions, 0) * 100) / 100
  ])) as RecipeNutrition;
}

export function calculationItems(rows: CalculatorRow[]): CalculatorItem[] {
  return rows.map(row => row.source === "fatsecret"
    ? { source: row.source, name: row.name, portions: row.portions, food_id: row.food_id, serving_id: row.serving_id }
    : { source: row.source, name: row.name, portions: row.portions, nutrition: row.values });
}

export function objects(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
}

export function servingNutrition(serving: Record<string, unknown>): RecipeNutrition {
  const mapping = { calories: "calories", protein_g: "protein", carbs_g: "carbohydrate", fat_g: "fat", fiber_g: "fiber" };
  return Object.fromEntries(NUTRIENTS.map(([field]) => {
    const raw = serving[mapping[field]];
    const value = raw == null || raw === "" ? NaN : Number(raw);
    return [field, Number.isFinite(value) && value >= 0 ? value : null];
  })) as RecipeNutrition;
}
