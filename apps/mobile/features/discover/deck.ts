// Shuffle once per visit/session. Stable input keeps background refreshes from moving the card.
export function shuffleRecipes<T extends { id: string }>(recipes: T[], seed: string): T[] {
  const result = [...recipes].sort((a, b) => a.id.localeCompare(b.id));
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  for (let index = result.length - 1; index > 0; index--) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    const other = (value >>> 0) % (index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
