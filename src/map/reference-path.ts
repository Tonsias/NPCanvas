import type { Dialogue, DialogueId, GameMap, MapId, Point } from '../project/types.ts'
import { mapLocalToCanvas } from './canvas-layout.ts'

// Canvas space, not map-local — an edge can join two lines on two different map images, the
// same reason the trail is drawn in canvas space (see trail-path.ts). An endpoint whose mapId
// is unknown, or whose target dialogue is gone, is dropped rather than guessed at — the same
// rule trailVertices applies to a dangling dialogue.
type ReferenceEdge = {
  from: DialogueId
  to: DialogueId
  fromPoint: Point
  toPoint: Point
}

// One edge per link, not per stored half: `Dialogue.references` is symmetric, so both endpoints
// name each other and a naive pass would draw every line twice. Deduplicated by the pair rather
// than by keeping one direction, so a half-written edge still draws.
export function referenceEdges(
  maps: readonly GameMap[],
  dialogues: readonly Dialogue[],
): readonly ReferenceEdge[] {
  const mapsById = new Map<MapId, GameMap>(maps.map((map) => [map.id, map]))
  const dialoguesById = new Map<DialogueId, Dialogue>(dialogues.map((dialogue) => [dialogue.id, dialogue]))

  const drawn = new Set<string>()
  const edges: ReferenceEdge[] = []
  for (const dialogue of dialogues) {
    const fromMap = mapsById.get(dialogue.mapId)
    if (fromMap === undefined) continue
    for (const targetId of dialogue.references) {
      const target = dialoguesById.get(targetId)
      if (target === undefined) continue
      const toMap = mapsById.get(target.mapId)
      if (toMap === undefined) continue
      const pair =
        dialogue.id < targetId ? `${dialogue.id} ${targetId}` : `${targetId} ${dialogue.id}`
      if (drawn.has(pair)) continue
      drawn.add(pair)
      edges.push({
        from: dialogue.id,
        to: target.id,
        fromPoint: mapLocalToCanvas(fromMap, dialogue.position),
        toPoint: mapLocalToCanvas(toMap, target.position),
      })
    }
  }
  return edges
}
