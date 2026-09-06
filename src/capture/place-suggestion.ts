import { dialoguesByTimeAsc } from '../dialogue/dialogue-order.ts'
import { toLocalDateTimeValue } from '../dialogue/local-datetime.ts'
import type { Dialogue, GameMap, MapId, PendingCapture, Point } from '../project/types.ts'

export const PLACE_SOURCES = ['frame', 'neighbour'] as const
export type PlaceSource = (typeof PLACE_SOURCES)[number]

export type PlaceSuggestion = {
  mapId: MapId
  position: Point
  source: PlaceSource
  confidence: number
  reason: string
}

const NEIGHBOUR_CONFIDENCE = 0.5

// Nearest in either direction; ascending order means a strict "closer than" comparison keeps the
// earlier candidate on a tie, since it is reached first.
export function suggestFromNeighbour(
  capture: PendingCapture,
  dialogues: readonly Dialogue[],
  maps: readonly GameMap[],
): PlaceSuggestion | null {
  const captureTime = Date.parse(capture.spokenAt)
  if (Number.isNaN(captureTime)) return null

  const ordered = dialoguesByTimeAsc(dialogues)
  let neighbour: Dialogue | null = null
  let bestDiff = Infinity
  for (const dialogue of ordered) {
    const diff = Math.abs(Date.parse(dialogue.spokenAt) - captureTime)
    if (diff < bestDiff) {
      bestDiff = diff
      neighbour = dialogue
    }
  }
  if (neighbour === null) return null
  if (!maps.some((map) => map.id === neighbour.mapId)) return null

  return {
    mapId: neighbour.mapId,
    position: neighbour.position,
    source: 'neighbour',
    confidence: NEIGHBOUR_CONFIDENCE,
    reason: `Near where ${neighbour.npcName} spoke at ${toLocalDateTimeValue(neighbour.spokenAt)}`,
  }
}
