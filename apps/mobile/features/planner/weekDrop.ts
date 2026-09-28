export type Rect = { x: number; y: number; width: number; height: number };

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
