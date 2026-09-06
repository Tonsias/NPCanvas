// Resolved from the id a gallery was told to show, not an index it was told to remember, so a
// reorder keeps that item on screen instead of whatever slid into its old position. An id no
// longer in the list falls to `previousIndex` — the item that took the vanished one's place —
// clamped to the new length, or to the last item when no previous position is known.
export function resolveGalleryIndex<Id extends string, T extends { id: Id }>(
  items: readonly T[],
  selectedId: Id | null,
  previousIndex: number | null = null,
): number {
  if (items.length === 0 || selectedId === null) return 0
  const index = items.findIndex((item) => item.id === selectedId)
  if (index !== -1) return index
  if (previousIndex === null) return items.length - 1
  return Math.min(previousIndex, items.length - 1)
}

// Clamped, not wrapped — wrapping from end to beginning would read as a new line appearing.
export function stepGalleryIndex(index: number, delta: number, length: number): number {
  if (length === 0) return 0
  return Math.min(Math.max(index + delta, 0), length - 1)
}
