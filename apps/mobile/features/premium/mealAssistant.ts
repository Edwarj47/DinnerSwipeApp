import { CalculatorRow, PROVIDER_VIEW_MS, servingNutrition } from "./calculator";
import { MealLabel } from "@/services/mealCategories";

export type MealDraftItem = { name: string; search_term: string; quantity: number | null; unit: string | null;
  food_id?: string; food_name?: string; servings?: Record<string, unknown>[]; lookup_unavailable?: boolean };
export type MealDraft = { request_id: string; status: "running" | "ready"; name: string; meal_label: MealLabel; items: MealDraftItem[] };
export type ReviewedFood = MealDraftItem & { key: string; serving_id: string; amount: string; expires: number;
  recommended_serving_id?: string; recommended_food_id?: string };

const MASS: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.349523125, ounce: 28.349523125, ounces: 28.349523125, lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237 };
const VOLUME: Record<string, number> = { ml: 1, milliliter: 1, milliliters: 1, millilitre: 1, millilitres: 1,
  l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000 };
const UNIT_ALIASES: Record<string, string> = { cups: "cup", tablespoons: "tbsp", tablespoon: "tbsp", tbs: "tbsp",
  teaspoons: "tsp", teaspoon: "tsp", eggs: "egg", pieces: "piece", items: "item", slices: "slice",
  "fluid ounces": "fl oz", "fluid ounce": "fl oz", servings: "serving", portions: "portion" };
const COUNT_MEASURES = new Set(["each", "egg", "piece", "item", "whole", "small", "medium", "large", "extra large", "jumbo"]);
function normalizeUnit(value: unknown): string {
  const unit = String(value ?? "").trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[unit] ?? (unit.length > 3 && unit.endsWith("s") && !unit.endsWith("ss") && !unit.endsWith("us") ? unit.slice(0, -1) : unit);
}

export function suggestedPortions(item: MealDraftItem, serving: Record<string, unknown>): number | null {
  if (item.quantity == null || !Number.isFinite(item.quantity) || item.quantity <= 0 || !item.unit) return null;
  const unit = normalizeUnit(item.unit);
  const metric = Number(serving.metric_serving_amount);
  const metricUnit = normalizeUnit(serving.metric_serving_unit);
  if (Number.isFinite(metric) && metric > 0) {
    if (MASS[unit] && MASS[metricUnit]) return item.quantity * MASS[unit] / (metric * MASS[metricUnit]);
    if (VOLUME[unit] && VOLUME[metricUnit]) return item.quantity * VOLUME[unit] / (metric * VOLUME[metricUnit]);
  }
  const units = Number(serving.number_of_units);
  const measure = normalizeUnit(serving.measurement_description);
  if (Number.isFinite(units) && units > 0 && (measure === unit || (unit === "each" && COUNT_MEASURES.has(measure))))
    return item.quantity / units;
  return null;
}

export function prefillServing(item: MealDraftItem): Pick<ReviewedFood, "serving_id" | "amount" | "recommended_serving_id"> {
  // Suggest only a measurable portion; ambiguous bowls/handfuls still need review.
  const candidates = (item.servings ?? []).flatMap((serving, index) => {
    const id = String(serving.serving_id ?? "");
    const amount = suggestedPortions(item, serving);
    if (!/^\d{1,20}$/.test(id) || amount == null || !Number.isFinite(amount) || amount <= 0 || amount > 100) return [];
    const unit = normalizeUnit(item.unit), measure = normalizeUnit(serving.measurement_description);
    const requestedSize = `${item.name} ${item.search_term}`.toLowerCase().match(/\b(extra large|jumbo|large|medium|small)\b/)?.[1];
    const servingSize = `${measure} ${String(serving.serving_description ?? "")}`.toLowerCase().match(/\b(extra large|jumbo|large|medium|small)\b/)?.[1];
    if (unit === "each" && requestedSize && servingSize !== requestedSize) return [];
    const size = requestedSize ?? (/\beggs?\b/i.test(item.name) ? "large" : "medium");
    const score = (measure === unit ? 100 : 0) + (unit === "each" && measure === size ? 50 : 0)
      + (Math.abs(amount - 1) < 0.000001 ? 20 : 0) + (String(serving.is_default) === "1" ? 10 : 0);
    return [{ id, amount, score, index }];
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const best = candidates[0];
  return best ? { serving_id: best.id, recommended_serving_id: best.id, amount: String(Number(best.amount.toPrecision(12))) }
    : { serving_id: "", recommended_serving_id: undefined, amount: "" };
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
