export type Rect = { x: number; y: number; width: number; height: number };
export type MealRect = Rect & { day: string };

export function findDropPosition(days: Map<string, Rect>, meals: Map<string, MealRect>, viewport: Rect, x: number, y: number, draggingId: string) {
  const day = findDropDay(days, viewport, x, y);
  if (day === null) return null;
  const before = [...meals].filter(([id, rect]) => id !== draggingId && rect.day === day)
    .sort((a, b) => a[1].y - b[1].y).find(([, rect]) => y < rect.y + rect.height / 2);
  return { day, beforeId: before?.[0] ?? null };
}

export function reorderDaySlots<T extends { id: string; slot_date: string | null; recipe_id: string | null; slot_type: string }>(slots: T[], id: string, beforeId: string | null) {
  const moving = slots.find(slot => slot.id === id);
  if (!moving) return null;
  const peers = slots.filter(slot => slot.slot_date === moving.slot_date && (slot.recipe_id || slot.slot_type !== "flexible"));
  if (!peers.some(slot => slot.id === id) || beforeId === id) return null;
  const ordered = peers.filter(slot => slot.id !== id).map(slot => slot.id);
  const index = beforeId === null ? ordered.length : ordered.indexOf(beforeId);
  if (index < 0) return null;
  ordered.splice(index, 0, id);
  const peerIds = new Set(peers.map(slot => slot.id));
  let cursor = 0;
  const result = slots.map(slot => peerIds.has(slot.id) ? ordered[cursor++] : slot.id);
  return result.some((slotId, position) => slotId !== slots[position].id) ? result : null;
}

export function findDropDay(targets: Map<string, Rect>, viewport: Rect, x: number, y: number) {
  if (x < viewport.x || x > viewport.x + viewport.width || y < viewport.y || y > viewport.y + viewport.height) return null;
  for (const [day, rect] of targets) {
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) return day;
  }
  return null;
}

export function dragScrollOffset(offset: number, y: number, viewport: Rect, contentHeight: number) {
  const edge = Math.min(64, viewport.height / 4);
  const step = y < viewport.y + edge ? -18 : y > viewport.y + viewport.height - edge ? 18 : 0;
  return Math.max(0, Math.min(Math.max(0, contentHeight - viewport.height), offset + step));
}
