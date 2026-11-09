/** Moves the item with `id` so it ends up at index `to` (clamped to the list). Returns the same array when nothing changes. */
export function moveById<T extends { id: string }>(list: T[], id: string, to: number): T[] {
  const from = list.findIndex((x) => x.id === id);
  if (from < 0) return list;
  const dest = Math.min(Math.max(0, Math.trunc(to)), list.length - 1);
  if (dest === from || Number.isNaN(dest)) return list;
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(dest, 0, item);
  return out;
}

/** Index the dragged item lands at when dropped into the gap before item `gap` (0..length) of the current list. */
export function dropIndex(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}
