export function hasTemporaryNutrition(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasTemporaryNutrition);
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return data.temporary_nutrition === true || Object.values(data).some(hasTemporaryNutrition);
}

// Retain user references, but remove expired provider values even if refresh fails.
export function expireNutrition(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expireNutrition);
  if (!value || typeof value !== "object") return value;
  const data = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expireNutrition(item)]));
  if (!data.temporary_nutrition) return data;
  data.temporary_nutrition = false;
  data.nutrition_unavailable = true;
  if (data.serving_labels) data.serving_labels = [];
  const fields = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g"];
  for (const field of fields) if (field in data) data[field] = null;
  if (data.totals) data.totals = Object.fromEntries(fields.map(field => [field,
    Array.isArray(data.items) ? null : 0]));
  if (data.averages) data.averages = Object.fromEntries(fields.map(field => [field, 0]));
  data.nutrition_unavailable_count = Math.max(1, Number(data.nutrition_unavailable_count) || 0);
  if (Array.isArray(data.resolved_items) && Array.isArray(data.items)) data.resolved_items = data.resolved_items.map((item, index) =>
    (data.items as { source: string }[])[index].source === "fatsecret" ? Object.fromEntries(fields.map(field => [field, null])) : item);
  if (Array.isArray(data.daily_totals)) data.daily_totals = data.daily_totals.map(day => ({ ...day,
    ...Object.fromEntries(fields.map(field => [field, 0])), nutrition_unavailable_count: 1 }));
  return data;
}
