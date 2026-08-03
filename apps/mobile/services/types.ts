export type Ingredient = {
  original_text: string;
  normalized_name: string;
  quantity?: number | null;
  unit?: string | null;
  preparation_note?: string | null;
  is_optional?: boolean;
  section?: string | null;
  sort_order?: number;
};

export type Instruction = {
  step_number: number;
  text: string;
  section?: string | null;
  timer_minutes?: number | null;
};

export type Recipe = {
  id: string;
  name: string;
  description?: string | null;
  photo_url?: string | null;
  servings: number;
  prep_minutes?: number | null;
  cook_minutes?: number | null;
  total_minutes?: number | null;
  difficulty: string;
  meal_type: string;
  source_type: string;
  source_url?: string | null;
  source_title?: string | null;
  validation_status: string;
  validation_warnings: string[];
  duplicate_status: string;
  image_status: string;
  ingredients: Ingredient[];
  instructions: Instruction[];
  tags: string[];
  is_favorite: boolean;
  is_hidden: boolean;
  last_selected_date?: string | null;
};

export type Household = {
  id: string;
  name: string;
  invite_code: string;
  current_user_role: string;
  members: { id: string; email: string; role: string }[];
};

export type VoteSummary = {
  weekly_plan_id: string;
  total_members: number;
  can_view_voters: boolean;
  top_match: VoteResult | null;
  votes: VoteResult[];
};

export type VoteResult = {
  recipe_id: string;
  recipe_name: string;
  yes: number;
  maybe: number;
  no: number;
  score: number;
  total_votes: number;
  majority_vote: "yes" | "maybe" | "no" | "tied";
  percentages: Partial<Record<"yes" | "maybe" | "no", number>>;
  voters?: { email: string; vote: "yes" | "maybe" | "no" }[];
};

export type UserProfile = {
  email: string;
  household_size: number;
  weekly_meal_target: number;
  max_cook_minutes: number | null;
  difficulty_preference: string | null;
  dietary_preferences: string[];
  allergens: string[];
  disliked_ingredients: string[];
  favorite_proteins: string[];
  budget_preference: string | null;
  walmart_zip: string | null;
  notification_preferences: Record<string, unknown>;
};

export type WeeklyPlan = {
  id: string;
  week_start: string;
  meal_target: number;
  slots: {
    id: string;
    slot_date: string | null;
    slot_type: "meal" | "leftovers" | "dining_out" | "flexible";
    recipe_id: string | null;
    recipe_name: string | null;
    recipe_photo_url?: string | null;
    recipe_total_minutes?: number | null;
    recipe_difficulty?: string | null;
    servings: number;
    is_locked: boolean;
    sort_order: number;
  }[];
};
