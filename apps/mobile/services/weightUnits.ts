export type WeightUnit = "g" | "oz";
export const GRAMS_PER_OUNCE = 28.349523125;

const gramsPerUnit: Record<string, number> = {
  g: 1, gram: 1, grams: 1, gm: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: GRAMS_PER_OUNCE, ounce: GRAMS_PER_OUNCE, ounces: GRAMS_PER_OUNCE,
  lb: GRAMS_PER_OUNCE * 16, lbs: GRAMS_PER_OUNCE * 16, pound: GRAMS_PER_OUNCE * 16, pounds: GRAMS_PER_OUNCE * 16
};

export function weightFactor(unit?: string | null): number | null {
  const key = unit?.trim().toLowerCase().replace(/\.$/, "") ?? "";
  return Object.prototype.hasOwnProperty.call(gramsPerUnit, key) ? gramsPerUnit[key] : null;
}

export function convertWeight(quantity: number, from: string | null | undefined, to: WeightUnit): number | null {
  const factor = weightFactor(from);
  return factor !== null && Number.isFinite(quantity) ? quantity * factor / gramsPerUnit[to] : null;
}

export function formatWeight(quantity: number, unit: WeightUnit): string {
  return String(Number(quantity.toFixed(unit === "oz" ? 3 : 2)));
}

export function ingredientWeightNote(quantity: number | null | undefined, from: string | null | undefined, to: WeightUnit | null): string | null {
  if (quantity == null || !to || weightFactor(from) === weightFactor(to)) return null;
  const converted = convertWeight(quantity, from, to);
  return converted === null ? null : `${formatWeight(converted, to)} ${to}`;
}

export function gramTextInUnit(text: string, unit: WeightUnit): string {
  if (unit === "g" || !text.trim() || !Number.isFinite(Number(text))) return text;
  return String(Number((Number(text) / GRAMS_PER_OUNCE).toFixed(6)));
}

export function unitTextInGrams(text: string, unit: WeightUnit): string {
  if (unit === "g" || !text.trim() || !Number.isFinite(Number(text))) return text;
  return String(Number(text) * GRAMS_PER_OUNCE);
}
