import type { ReactElement } from 'react'

/** How many rows a long insights list shows before `FoldRows` hides the tail. */
export const ROW_LIMIT = 15

/**
 * The fold control the two breakdown charts and the dossier's NPC index share — one limit and
 * one wording, so a reader learns "top 15, click for the rest" once rather than per panel.
 */
export function FoldRows({
  expanded,
  total,
  noun,
  onToggle,
}: {
  expanded: boolean
  total: number
  noun: string
  onToggle: () => void
}): ReactElement {
  return (
    <button
      type="button"
      className="insights__expand-rows disclosure-summary"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {expanded ? `Fold back to the top ${ROW_LIMIT}` : `Show all ${total} ${noun}`}
    </button>
  )
}
