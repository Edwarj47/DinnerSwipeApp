import { CalculatorRow, PROVIDER_VIEW_MS, servingNutrition } from "./calculator";
import { MealLabel } from "@/services/mealCategories";

export type MealDraftItem = { name: string; search_term: string; quantity: number | null; unit: string | null;
  food_id?: string; food_name?: string; servings?: Record<string, unknown>[]; lookup_unavailable?: boolean };
export type MealDraft = { request_id: string; status: "running" | "ready"; name: string; meal_label: MealLabel; items: MealDraftItem[] };
export type ReviewedFood = MealDraftItem & { key: string; serving_id: string; amount: string; expires: number };

export function suggestedPortions(item: MealDraftItem, serving: Record<string, unknown>): number | null {
  if (item.quantity == null || !item.unit) return null;
  const unit = item.unit.toLowerCase().replace(/\.$/, "");
  const mass: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000,
    oz: 28.349523125, ounce: 28.349523125, ounces: 28.349523125, lb: 453.59237, lbs: 453.59237, pounds: 453.59237 };
  const metric = Number(serving.metric_serving_amount);
  if (mass[unit] && String(serving.metric_serving_unit).toLowerCase() === "g" && metric > 0)
    return item.quantity * mass[unit] / metric;
  const units = Number(serving.number_of_units);
  const measure = String(serving.measurement_description ?? "").toLowerCase();
  if (units > 0 && (measure === unit || measure.replace(/s$/, "") === unit.replace(/s$/, ""))) return item.quantity / units;
  return null;
}

export function reviewedRows(items: ReviewedFood[]): CalculatorRow[] {
  if (!items.length) throw new Error("Keep at least one item.");
  return items.map(item => {
    const serving = item.servings?.find(value => String(value.serving_id) === item.serving_id);
    const amount = Number(item.amount);
    if (!item.food_id || !serving) throw new Error(`Choose a database match and serving for ${item.name}.`);
    if (!item.amount.trim() || !Number.isFinite(amount) || amount <= 0 || amount > 100) throw new Error(`Enter servings eaten for ${item.name} (up to 100).`);
    if (item.expires <= Date.now()) throw new Error("These results expired. Describe the meal again.");
    return { key: item.key, source: "fatsecret", name: item.name, food_id: item.food_id, serving_id: item.serving_id,
      portions: amount, values: servingNutrition(serving), servingLabel: String(serving.serving_description ?? "Serving"),
      foodLabel: item.food_name, expires: Math.min(item.expires, Date.now() + PROVIDER_VIEW_MS) };
  });
}
