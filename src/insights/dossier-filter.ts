import type { Dialogue, DialogueId, Quest, QuestId, ZoneId } from '../project/types.ts'
import type { SegmentKey } from './relevance-segments.ts'

// A second filter stacked on the global one, never merged with it: it narrows one NPC's lines
// only, so it is spelled in what the dossier already draws — relevance *segments*, untagged
// included (which DialogueFilter's RelevanceTagId[] cannot say), zones, quests. Fields combine
// with AND, values inside one with OR, as in applyFilter.
export type DossierFilter = {
  relevance: readonly SegmentKey[]
  zones: readonly ZoneId[]
  quests: readonly QuestId[]
}

export const EMPTY_DOSSIER_FILTER: DossierFilter = { relevance: [], zones: [], quests: [] }

export function isEmptyDossierFilter(filter: DossierFilter): boolean {
  return filter.relevance.length === 0 && filter.zones.length === 0 && filter.quests.length === 0
}

// Takes the two indexes, for the reason applyFilter does: location is derived, never stored.
export function applyDossierFilter(
  dialogues: readonly Dialogue[],
  filter: DossierFilter,
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>,
  questsByDialogue: ReadonlyMap<DialogueId, Quest[]>,
): Dialogue[] {
  return dialogues.filter((dialogue) => {
    if (
      filter.relevance.length > 0 &&
      !filter.relevance.some((segment) => matchesSegment(dialogue, segment))
    ) {
      return false
    }

    if (filter.zones.length > 0) {
      const inside = zoneIndex.get(dialogue.id) ?? []
      if (!filter.zones.some((zoneId) => inside.includes(zoneId))) return false
    }

    if (filter.quests.length > 0) {
      const threads = questsByDialogue.get(dialogue.id) ?? []
      if (!filter.quests.some((questId) => threads.some((quest) => quest.id === questId))) {
        return false
      }
    }

    return true
  })
}

function matchesSegment(dialogue: Dialogue, segment: SegmentKey): boolean {
  return segment === 'untagged'
    ? dialogue.relevance.length === 0
    : dialogue.relevance.includes(segment)
}

// Switching NPC keeps whatever the next one still offers a chip for and drops the rest, so no
// value stays active that nothing on screen shows. Same object back when nothing was dropped.
export function pruneDossierFilter(filter: DossierFilter, offered: DossierFilter): DossierFilter {
  const relevance = filter.relevance.filter((segment) => offered.relevance.includes(segment))
  const zones = filter.zones.filter((zoneId) => offered.zones.includes(zoneId))
  const quests = filter.quests.filter((questId) => offered.quests.includes(questId))
  const kept =
    relevance.length === filter.relevance.length &&
    zones.length === filter.zones.length &&
    quests.length === filter.quests.length
  return kept ? filter : { relevance, zones, quests }
}
