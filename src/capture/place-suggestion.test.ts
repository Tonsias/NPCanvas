import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asPendingCaptureId } from '../project/ids.ts'
import type { Dialogue, GameMap, PendingCapture } from '../project/types.ts'
import { suggestFromNeighbour } from './place-suggestion.ts'

const MAP_A = asMapId('map-a')
const MAP_B = asMapId('map-b')

const MAPS: GameMap[] = [
  { id: MAP_A, name: 'A', file: { fileName: 'a.png', mimeType: 'image/png', byteSize: 0 }, width: 100, height: 100, origin: { x: 0, y: 0 }, scale: 1 },
  { id: MAP_B, name: 'B', file: { fileName: 'b.png', mimeType: 'image/png', byteSize: 0 }, width: 100, height: 100, origin: { x: 200, y: 0 }, scale: 1 },
]

function dialogue(id: string, spokenAt: string, mapId = MAP_A, position = { x: 10, y: 20 }): Dialogue {
  return {
    id: asDialogueId(id),
    mapId,
    npcName: id,
    position,
    text: '',
    media: [],
    spokenAt,
    relevance: [],
    references: [],
  }
}

function capture(spokenAt: string): PendingCapture {
  return {
    id: asPendingCaptureId('capture'),
    npcName: 'someone',
    text: '',
    media: [],
    spokenAt,
    relevance: [],
  }
}

describe('suggestFromNeighbour', () => {
  it('picks the nearest dialogue before the capture', () => {
    const before = dialogue('before', '2026-01-01T00:00:00.000Z')
    const far = dialogue('far', '2026-01-01T00:10:00.000Z')
    const suggestion = suggestFromNeighbour(capture('2026-01-01T00:01:00.000Z'), [before, far], MAPS)
    expect(suggestion?.mapId).toBe(before.mapId)
    expect(suggestion?.position).toEqual(before.position)
    expect(suggestion?.source).toBe('neighbour')
  })

  it('picks the nearest dialogue after the capture', () => {
    const after = dialogue('after', '2026-01-01T00:05:00.000Z')
    const far = dialogue('far', '2026-01-01T00:30:00.000Z')
    const suggestion = suggestFromNeighbour(capture('2026-01-01T00:04:00.000Z'), [after, far], MAPS)
    expect(suggestion?.position).toEqual(after.position)
  })

  it('resolves a tie to the earlier dialogue', () => {
    const earlier = dialogue('earlier', '2026-01-01T00:00:00.000Z')
    const later = dialogue('later', '2026-01-01T00:10:00.000Z')
    // capture sits exactly between the two, five minutes from each
    const suggestion = suggestFromNeighbour(capture('2026-01-01T00:05:00.000Z'), [earlier, later], MAPS)
    expect(suggestion?.position).toEqual(earlier.position)
  })

  it('returns null when no dialogue has been placed yet', () => {
    expect(suggestFromNeighbour(capture('2026-01-01T00:00:00.000Z'), [], MAPS)).toBeNull()
  })

  it('returns null when the capture spokenAt is unparseable', () => {
    const only = dialogue('only', '2026-01-01T00:00:00.000Z')
    expect(suggestFromNeighbour(capture('not a date'), [only], MAPS)).toBeNull()
  })

  it('returns null when the neighbour maps to no GameMap', () => {
    const dangling = dialogue('dangling', '2026-01-01T00:00:00.000Z', asMapId('gone'))
    expect(suggestFromNeighbour(capture('2026-01-01T00:00:00.000Z'), [dangling], MAPS)).toBeNull()
  })

  it('copies position verbatim, with no offset', () => {
    const neighbour = dialogue('neighbour', '2026-01-01T00:00:00.000Z', MAP_B, { x: 73, y: 41 })
    const suggestion = suggestFromNeighbour(capture('2026-01-01T00:00:01.000Z'), [neighbour], MAPS)
    expect(suggestion?.position).toEqual({ x: 73, y: 41 })
    expect(suggestion?.mapId).toBe(MAP_B)
  })
})
