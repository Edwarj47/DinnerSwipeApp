import { RecipeNutrition } from "@/services/types";

export const NUTRIENTS = [
  ["calories", "Calories"], ["protein_g", "Protein (g)"], ["carbs_g", "Carbs (g)"],
  ["fat_g", "Fat (g)"], ["fiber_g", "Fiber (g)"]
] as const;
export type NutritionInputs = Record<keyof RecipeNutrition, string>;
export const EMPTY_NUTRITION: NutritionInputs = { calories: "", protein_g: "", carbs_g: "", fat_g: "", fiber_g: "" };

export function nutritionInputs(nutrition?: Partial<RecipeNutrition> | null, portions = 1): NutritionInputs {
  return Object.fromEntries(NUTRIENTS.map(([key]) => [key, nutrition?.[key] == null ? "" : String(Math.round(nutrition[key]! * portions * 100) / 100)])) as NutritionInputs;
}

export function parseNutrition(inputs: NutritionInputs, divisor = 1): RecipeNutrition {
  if (!Number.isFinite(divisor) || divisor <= 0) throw new Error("Enter a valid number of servings.");
  return Object.fromEntries(NUTRIENTS.map(([key, label]) => {
    const text = inputs[key].trim();
    const value = text === "" ? null : Number(text);
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error(`${label} must be zero or greater.`);
    return [key, value === null ? null : Math.round(value / divisor * 100) / 100];
  })) as RecipeNutrition;
}

export function scaleNutritionInputs(inputs: NutritionInputs, ratio: number): NutritionInputs {
  return nutritionInputs(parseNutrition(inputs), ratio);
}
