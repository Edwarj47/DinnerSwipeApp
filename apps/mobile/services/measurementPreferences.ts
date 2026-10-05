import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { RecipeNutrition, UserProfile } from "./types";
import { WeightUnit } from "./weightUnits";

export type NutrientWeight = Exclude<keyof RecipeNutrition, "calories">;
export type Measurement = NutrientWeight | "ingredient_weight";
export const MEASUREMENTS: { key: Measurement; label: string; preference: string }[] = [
  { key: "protein_g", label: "Protein", preference: "protein_unit" },
  { key: "carbs_g", label: "Carbs", preference: "carbs_unit" },
  { key: "fat_g", label: "Fat", preference: "fat_unit" },
  { key: "fiber_g", label: "Fiber", preference: "fiber_unit" },
  { key: "ingredient_weight", label: "Ingredient weights", preference: "ingredient_weight_unit" }
];

export function measurementUnits(profile?: Pick<UserProfile, "notification_preferences">): Record<Measurement, WeightUnit> {
  return Object.fromEntries(MEASUREMENTS.map(({ key, preference }) => [key,
    profile?.notification_preferences?.[preference] === "oz" ? "oz" : "g"
  ])) as Record<Measurement, WeightUnit>;
}

export function useMeasurementUnits() {
  const profile = useQuery<UserProfile>({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/api/v1/profile"), staleTime: 60_000, retry: false });
  return measurementUnits(profile.data);
}
