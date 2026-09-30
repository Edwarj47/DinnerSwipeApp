export type AiRecipeDraft = {
  name: string;
  description: string;
  servings: number;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  difficulty: string;
  meal_type: string;
  ingredients: string[];
  instructions: string[];
  review_notes: string[];
};

export type AiRecipeJob = { id: string; status: string; draft: AiRecipeDraft | null };
