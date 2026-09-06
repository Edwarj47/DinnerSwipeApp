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
  allergen_filter_mode: SafetyFilterMode;
  dislike_filter_mode: SafetyFilterMode;
  current_user_role: string;
  members: { id: string; email: string; role: string }[];
};

export type SafetyFilterMode = "off" | "warn" | "block";

export type VoteOption = {
  recipe: Recipe;
  is_blocked: boolean;
  warning_labels: string[];
  blocked_labels: string[];
  safety_notes: string[];
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
  preferred_grocery_retailer: "walmart" | "publix" | "kroger" | "instacart";
  notification_preferences: Record<string, unknown>;
  onboarding_completed_at?: string | null;
  tutorial_completed_at?: string | null;
  tutorial_dismissed_at?: string | null;
  tutorial_version_seen?: string | null;
};

export type SubscriptionTier = "basic" | "premium";

export type SubscriptionPlanStatus = {
  tier: SubscriptionTier;
  plan_key: string;
  display_name: string;
  description: string;
  monthly_price_cents: number;
  stripe_configured: boolean;
  active: boolean;
};

export type PremiumStatus = {
  active: boolean;
  plan_key: string;
  status: string;
  source?: string | null;
  monthly_price_cents: number;
  stripe_configured: boolean;
  billing_management_available: boolean;
  current_period_end?: string | null;
  cancel_at_period_end: boolean;
  current_tier: "none" | "trial" | "basic" | "premium";
  basic_active: boolean;
  basic_subscription_active: boolean;
  premium_active: boolean;
  trial_active: boolean;
  trial_ends_at?: string | null;
  trial_days_remaining: number;
  basic_monthly_price_cents: number;
  premium_monthly_price_cents: number;
  basic_stripe_configured: boolean;
  premium_stripe_configured: boolean;
  plans: SubscriptionPlanStatus[];
};

export type MacroTarget = {
  id?: string | null;
  daily_calories?: number | null;
  daily_protein_g?: number | null;
  daily_carbs_g?: number | null;
  daily_fat_g?: number | null;
  goal?: string | null;
};

export type MacroConfirmation = {
  id: string;
  recipe_id?: string | null;
  recipe_name?: string | null;
  weekly_plan_slot_id?: string | null;
  meal_date: string;
  status: "ate" | "skipped";
  servings_consumed: number;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  fiber_g?: number | null;
  macro_source: string;
  notes?: string | null;
  created_at: string;
};

export type MacroSummary = {
  days: number;
  start_date: string;
  end_date: string;
  active: boolean;
  targets: MacroTarget;
  totals: Record<"calories" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g", number>;
  eaten_meals: number;
  skipped_meals: number;
  unmatched_meals: number;
  recent_confirmations: MacroConfirmation[];
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
