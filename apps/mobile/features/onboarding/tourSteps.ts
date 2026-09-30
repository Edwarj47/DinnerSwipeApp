export const TUTORIAL_VERSION = "2026-09-29";

export const TOUR_SECTIONS = [
  { id: "recipes", label: "Recipes", icon: "book-outline" },
  { id: "discover", label: "Discover", icon: "flame-outline" },
  { id: "week", label: "This Week", icon: "calendar-outline" },
  { id: "grocery", label: "Groceries", icon: "basket-outline" },
  { id: "preferences", label: "Food preferences", icon: "options-outline" },
  { id: "groups", label: "Groups", icon: "people-outline" },
  { id: "macros", label: "Premium macros", icon: "stats-chart-outline" },
  { id: "account", label: "Account settings", icon: "person-outline" }
] as const;
export type TourSection = typeof TOUR_SECTIONS[number]["id"];
export type TourStep = {
  id: string; section: TourSection; title: string; body: string;
  path: "/recipes" | "/" | "/week" | "/grocery" | "/profile";
  params?: Record<string, string>;
};
export const TOUR_STEPS: TourStep[] = [
  { id: "recipe-library", section: "recipes", path: "/recipes", params: { mode: "library" },
    title: "Your recipe collection", body: "Search your saved meals here. Tap a recipe to read it; hold it for more actions. An empty library is fine for this tour." },
  { id: "recipe-add", section: "recipes", path: "/recipes", params: { mode: "add", method: "web" },
    title: "Add a dinner you love", body: "Choose Web for a recipe link, Manual to write your own, or AI to draft from a description or photo. Review imported and AI recipes before saving. You can continue without saving." },
  { id: "discover", section: "discover", path: "/", params: { replace_slot_id: "", replace_name: "" },
    title: "Find your next dinner", body: "Swipe right to plan, left to skip, up to favorite, or down to hide. Tap a meal for details and the same choices. Undo reverses your latest Plan selection." },
  { id: "week", section: "week", path: "/week",
    title: "Make the week yours", body: "Add meal opens this week's picks or all recipes. Add several meals to a day, move them with the drag handle, or use Edit. Reset can clear one day or the whole week." },
  { id: "grocery-list", section: "grocery", path: "/grocery", params: { mode: "list" },
    title: "Shop from your plan", body: "Regenerate builds ingredients from your planned meals. Check items off, or tap one to adjust it and search your preferred store. Add keeps household extras on the list." },
  { id: "grocery-pantry", section: "grocery", path: "/grocery", params: { mode: "pantry" },
    title: "Already in the cupboard?", body: "Add pantry staples here to leave them out of generated groceries. Regenerate the list after saving an exclusion. This step is optional." },
  { id: "preferences", section: "preferences", path: "/profile", params: { section: "meals" },
    title: "Food and shopping preferences", body: "Choose default servings and a store, then add allergens or dislikes. Save only changes you want to keep. Group owners control allergy warnings or blocking; always check ingredients." },
  { id: "groups", section: "groups", path: "/profile", params: { section: "group" },
    title: "Plan with your people", body: "Keep a private kitchen, create a shared group, or join by invitation. Select a group to vote and manage invitations. Basic allows one shared group; Premium allows unlimited groups." },
  { id: "macros", section: "macros", path: "/profile", params: { section: "macros" },
    title: "Your daily nutrition", body: "Log a meal or snack, or confirm a planned meal in This Week. Switch between Day, Grid, Calendar, and Trends. Choose a period before exporting. The overview shows the last seven days." },
  { id: "account", section: "account", path: "/profile", params: { section: "account" },
    title: "Set your own defaults", body: "Control reset confirmations and, on supported phones, biometrics and the lock timeout. Replay tour stays in Account whenever you need it." }
];
export function tourStepsFor(sections: TourSection[], premium: boolean) {
  return TOUR_STEPS.filter(step => sections.includes(step.section) && (step.section !== "macros" || premium));
}
export function nextSectionIndex(steps: TourStep[], index: number) {
  const next = steps.findIndex((step, position) => position > index && step.section !== steps[index]?.section);
  return next === -1 ? steps.length : next;
}
