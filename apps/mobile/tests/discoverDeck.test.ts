import { shuffleRecipes } from "@/features/discover/deck";

test("shuffles without mutation or duplicates and stays stable during a visit", () => {
  const recipes = Array.from({ length: 12 }, (_, id) => ({ id: String(id) }));
  const original = [...recipes];
  const shuffled = shuffleRecipes(recipes, "visit-1");
  expect(shuffled).toEqual(shuffleRecipes([...recipes].reverse(), "visit-1"));
  expect(new Set(shuffled.map(recipe => recipe.id)).size).toBe(12);
  expect(recipes).toEqual(original);
  expect(shuffled).not.toEqual(shuffleRecipes(recipes, "visit-2"));
  expect(shuffleRecipes([], "empty")).toEqual([]);
  expect(shuffleRecipes([recipes[0]], "single")).toEqual([recipes[0]]);
});
