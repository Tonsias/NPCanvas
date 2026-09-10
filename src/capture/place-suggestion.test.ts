import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asPendingCaptureId } from '../project/ids.ts'
import type { Dialogue, GameMap, MapId, PendingCapture } from '../project/types.ts'
import type { WindowMatch } from './frame-locate.ts'
import {
  contextScore,
  isConfident,
  mapsToScore,
  orderCandidateMaps,
  placementTrail,
  PLAYER_IN_WINDOW,
  RING_DEPTH_DEFAULT,
  RING_DEPTH_STEP,
  suggestFromNeighbour,
  suggestPlacement,
  topCandidates,
  withResults,
  type MapCandidate,
  type PlacementAnchor,
  type RingSearch,
} from './place-suggestion.ts'

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

function gameMap(id: string, origin: { x: number; y: number }, size: number | { width: number; height: number }): GameMap {
  const { width, height } = typeof size === 'number' ? { width: size, height: size } : size
  return {
    id: asMapId(id),
    name: id,
    file: { fileName: `${id}.png`, mimeType: 'image/png', byteSize: 0 },
    width,
    height,
    origin,
    scale: 1,
  }
}

function anchorOn(map: GameMap, position = { x: 0, y: 0 }, weight = 1): PlacementAnchor {
  return {
    mapId: map.id,
    point: { x: map.origin.x + position.x * map.scale, y: map.origin.y + position.y * map.scale },
    position,
    weight,
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

describe('placementTrail', () => {
  it('takes the nearest lines in time, in either direction, nearest first', () => {
    const before = dialogue('before', '2026-01-01T00:00:50.000Z')
    const after = dialogue('after', '2026-01-01T00:01:05.000Z')
    const far = dialogue('far', '2026-01-01T00:20:00.000Z', MAP_B)
    const trail = placementTrail(capture('2026-01-01T00:01:00.000Z'), [far, before, after], MAPS)
    expect(trail).toHaveLength(3)
    expect(trail[0].position).toEqual(after.position)
    expect(trail[2].mapId).toBe(MAP_B)
    expect(trail[0].weight).toBeGreaterThan(trail[1].weight)
    expect(trail[1].weight).toBeGreaterThan(trail[2].weight)
  })

  it('keeps at most three anchors, however many lines are placed', () => {
    const lines = Array.from({ length: 9 }, (_, index) =>
      dialogue(`line-${index}`, `2026-01-01T00:0${index}:00.000Z`),
    )
    expect(placementTrail(capture('2026-01-01T00:00:30.000Z'), lines, MAPS)).toHaveLength(3)
  })

  it('carries the anchor point into canvas space, scale included', () => {
    const scaled: GameMap = { ...gameMap('c', { x: 1000, y: 2000 }, 100), scale: 2 }
    const placed = dialogue('placed', '2026-01-01T00:00:00.000Z', scaled.id, { x: 10, y: 20 })
    const trail = placementTrail(capture('2026-01-01T00:00:01.000Z'), [placed], [scaled])
    expect(trail[0].point).toEqual({ x: 1020, y: 2040 })
    expect(trail[0].position).toEqual({ x: 10, y: 20 })
  })

  it('skips a line whose map is gone, and is empty for an unparseable capture', () => {
    const dangling = dialogue('dangling', '2026-01-01T00:00:00.000Z', asMapId('gone'))
    expect(placementTrail(capture('2026-01-01T00:00:01.000Z'), [dangling], MAPS)).toEqual([])
    expect(placementTrail(capture('not a date'), [dialogue('ok', '2026-01-01T00:00:00.000Z')], MAPS)).toEqual([])
  })
})

describe('contextScore', () => {
  const here = gameMap('here', { x: 0, y: 0 }, 100)
  const next = gameMap('next', { x: 150, y: 0 }, 100)
  const far = gameMap('far', { x: 100000, y: 0 }, 100)

  it('is zero with no trail, and never negative', () => {
    expect(contextScore(here, [])).toBe(0)
    expect(contextScore(far, [anchorOn(here)])).toBeGreaterThanOrEqual(0)
  })

  it('ranks the map the trail stood on over a neighbour, and a neighbour over a distant map', () => {
    const trail = [anchorOn(here)]
    expect(contextScore(here, trail)).toBeGreaterThan(contextScore(next, trail))
    expect(contextScore(next, trail)).toBeGreaterThan(contextScore(far, trail))
  })

  it('weighs a heavier anchor above a lighter one', () => {
    const strong = contextScore(next, [anchorOn(here, { x: 0, y: 0 }, 1)])
    const weak = contextScore(next, [anchorOn(far, { x: 0, y: 0 }, 1), anchorOn(here, { x: 0, y: 0 }, 0.1)])
    expect(strong).toBeGreaterThan(weak)
  })
})

describe('orderCandidateMaps', () => {
  it('returns the document order when the trail is empty', () => {
    const maps = [gameMap('a', { x: 0, y: 0 }, 100), gameMap('b', { x: 500, y: 0 }, 100)]
    expect(orderCandidateMaps([], maps)).toEqual([maps[0].id, maps[1].id])
  })

  it('puts the map the trail stood on first, then the rest by distance from it', () => {
    const from = gameMap('a', { x: 0, y: 0 }, 100)
    const touching = gameMap('b', { x: 100, y: 0 }, 100)
    const far = gameMap('c', { x: 9000, y: 0 }, 100)
    expect(orderCandidateMaps([anchorOn(from)], [far, from, touching])).toEqual([from.id, touching.id, far.id])
  })

  it('measures from the anchor point rather than from the map it sits on', () => {
    const from = gameMap('a', { x: 0, y: 0 }, 1000)
    const east = gameMap('east', { x: 1100, y: 0 }, 100)
    const west = gameMap('west', { x: -200, y: 0 }, 100)
    // The player last spoke at the east edge of `from`, so `east` is the nearer door.
    const trail = [anchorOn(from, { x: 990, y: 500 })]
    expect(orderCandidateMaps(trail, [west, east])[0]).toBe(east.id)
  })

  it('is total and stable: the same inputs give the same order', () => {
    const from = gameMap('a', { x: 0, y: 0 }, 100)
    const maps = [gameMap('b', { x: 300, y: 0 }, 50), from, gameMap('c', { x: 300, y: 0 }, 50)]
    const trail = [anchorOn(from)]
    expect(orderCandidateMaps(trail, maps)).toEqual(orderCandidateMaps(trail, [...maps]))
  })
})

describe('mapsToScore / withResults', () => {
  function search(order: readonly MapId[]): RingSearch {
    return { order, depth: 0, results: new Map() }
  }

  const ORDER = Array.from({ length: 24 }, (_, index) => asMapId(`map-${index}`))

  function matchesFor(ids: readonly MapId[]): ReadonlyMap<MapId, WindowMatch | null> {
    return new Map(ids.map((id, index) => [id, { x: 0, y: 0, score: index / ids.length }]))
  }

  it('asks for exactly the new ids when deepening 12 to 24', () => {
    const initial = withResults(search(ORDER), 12, matchesFor(ORDER.slice(0, 12)))
    const toScore = mapsToScore(initial, 24)
    expect(toScore).toEqual(ORDER.slice(12, 24))
    expect(toScore).toHaveLength(12)
  })

  it('folds results in across two deepenings without rescoring', () => {
    let current = search(ORDER)
    current = withResults(current, 8, matchesFor(ORDER.slice(0, 8)))
    current = withResults(current, 16, matchesFor(ORDER.slice(8, 16)))
    expect(current.depth).toBe(16)
    expect([...current.results.keys()]).toEqual(ORDER.slice(0, 16))
  })

  it('returns an empty array, and rescoring nothing, when the depth did not grow', () => {
    const initial = withResults(search(ORDER), 12, matchesFor(ORDER.slice(0, 12)))
    expect(mapsToScore(initial, 12)).toEqual([])
    expect(mapsToScore(initial, 4)).toEqual([])

    const stale = new Map([[ORDER[0], { x: 99, y: 99, score: 0 }]])
    const unchanged = withResults(initial, 4, stale)
    expect(unchanged.results.get(ORDER[0])).toEqual(initial.results.get(ORDER[0]))
  })

  it('#170: widening twice in a row costs two disjoint slices', () => {
    const order = Array.from({ length: RING_DEPTH_DEFAULT + 2 * RING_DEPTH_STEP }, (_, index) =>
      asMapId(`ring-${index}`),
    )
    let current = withResults(search(order), RING_DEPTH_DEFAULT, matchesFor(order.slice(0, RING_DEPTH_DEFAULT)))

    const firstWiden = mapsToScore(current, RING_DEPTH_DEFAULT + RING_DEPTH_STEP)
    expect(firstWiden).toEqual(order.slice(RING_DEPTH_DEFAULT, RING_DEPTH_DEFAULT + RING_DEPTH_STEP))
    current = withResults(current, RING_DEPTH_DEFAULT + RING_DEPTH_STEP, matchesFor(firstWiden))

    const secondWiden = mapsToScore(current, RING_DEPTH_DEFAULT + 2 * RING_DEPTH_STEP)
    expect(secondWiden).toEqual(
      order.slice(RING_DEPTH_DEFAULT + RING_DEPTH_STEP, RING_DEPTH_DEFAULT + 2 * RING_DEPTH_STEP),
    )
    // disjoint: nothing the first widen asked for appears in the second's slice
    expect(secondWiden.some((id) => firstWiden.includes(id))).toBe(false)
    expect(current.depth).toBe(RING_DEPTH_DEFAULT + RING_DEPTH_STEP)
  })
})

describe('topCandidates', () => {
  const here = gameMap('here', { x: 0, y: 0 }, 100)
  const next = gameMap('next', { x: 150, y: 0 }, 100)
  const far = gameMap('far', { x: 50000, y: 0 }, 100)
  const maps = [here, next, far]
  const searchOf = (results: ReadonlyMap<MapId, WindowMatch | null>): RingSearch => ({
    order: [...results.keys()],
    depth: results.size,
    results,
  })

  it('orders by picture score when no trail says otherwise', () => {
    const search = searchOf(new Map<MapId, WindowMatch | null>([
      [here.id, { x: 0, y: 0, score: 0.2 }],
      [next.id, { x: 0, y: 0, score: 0.9 }],
      [far.id, { x: 0, y: 0, score: 0.5 }],
    ]))
    expect(topCandidates(search, [], maps, 3).map((candidate) => candidate.mapId)).toEqual([next.id, far.id, here.id])
  })

  it('lets the trail decide between pictures that say the same thing', () => {
    // Every interior in this game is drawn from the same tiles, so all three score alike. Where the
    // player was is then the only thing left that separates them.
    const search = searchOf(new Map<MapId, WindowMatch | null>([
      [far.id, { x: 0, y: 0, score: 0.71 }],
      [next.id, { x: 0, y: 0, score: 0.7 }],
      [here.id, { x: 0, y: 0, score: 0.7 }],
    ]))
    expect(topCandidates(search, [anchorOn(here)], maps, 3).map((candidate) => candidate.mapId)).toEqual([
      here.id,
      next.id,
      far.id,
    ])
  })

  it('lets a picture that separates itself win against the trail', () => {
    const search = searchOf(new Map<MapId, WindowMatch | null>([
      [here.id, { x: 0, y: 0, score: 0.55 }],
      [far.id, { x: 0, y: 0, score: 0.98 }],
    ]))
    expect(topCandidates(search, [anchorOn(here)], maps, 1)[0].mapId).toBe(far.id)
  })

  it('adds PLAYER_IN_WINDOW to a trusted offset, including a negative one', () => {
    const search = searchOf(new Map<MapId, WindowMatch | null>([[here.id, { x: -32, y: -16, score: 0.95 }]]))
    const candidate = topCandidates(search, [], maps, 1)[0]
    expect(candidate.position).toEqual({ x: -32 + PLAYER_IN_WINDOW.x, y: -16 + PLAYER_IN_WINDOW.y })
    expect(candidate.picture).toBe(0.95)
  })

  it('falls back to where the player last stood when the picture is weak', () => {
    const search = searchOf(new Map<MapId, WindowMatch | null>([[here.id, { x: 400, y: 400, score: 0.4 }]]))
    expect(topCandidates(search, [anchorOn(here, { x: 12, y: 34 })], maps, 1)[0].position).toEqual({ x: 12, y: 34 })
  })

  it('skips maps with no match and limits to n', () => {
    const search = searchOf(new Map<MapId, WindowMatch | null>([
      [here.id, null],
      [next.id, { x: 0, y: 0, score: 0.6 }],
      [far.id, { x: 0, y: 0, score: 0.8 }],
    ]))
    const top = topCandidates(search, [], maps, 1)
    expect(top).toHaveLength(1)
    expect(top[0].mapId).toBe(far.id)
  })
})

describe('isConfident', () => {
  const candidate = (picture: number): MapCandidate => ({
    mapId: asMapId('a'),
    position: { x: 0, y: 0 },
    score: picture,
    picture,
  })

  it('is false below LOCATE_ACCEPT regardless of margin', () => {
    expect(isConfident(candidate(0.9), null)).toBe(false)
    expect(isConfident(candidate(0.9), candidate(0.5))).toBe(false)
  })

  it('is true at LOCATE_ACCEPT with no runner-up', () => {
    expect(isConfident(candidate(0.92), null)).toBe(true)
  })

  it('is false when the runner-up is within LOCATE_MARGIN', () => {
    expect(isConfident(candidate(0.93), candidate(0.91))).toBe(false)
  })

  it('is true when the runner-up is beyond LOCATE_MARGIN', () => {
    expect(isConfident(candidate(0.96), candidate(0.9))).toBe(true)
  })

  it('judges the picture alone, never the fused score', () => {
    // A candidate the trail pushed to the top carries a high `score` and a weak `picture`: context
    // can order the list, but it must never claim the frame itself was recognised.
    const lifted: MapCandidate = { mapId: asMapId('a'), position: { x: 0, y: 0 }, score: 1.4, picture: 0.6 }
    expect(isConfident(lifted, null)).toBe(false)
  })
})

describe('suggestPlacement', () => {
  it('always closes the list with the clock entry, frame candidates or none', () => {
    const neighbour = dialogue('neighbour', '2026-01-01T00:00:00.000Z', MAP_A, { x: 5, y: 5 })
    const cap = capture('2026-01-01T00:00:01.000Z')

    const empty: RingSearch = { order: [], depth: 0, results: new Map() }
    const withoutFrame = suggestPlacement(empty, cap, [neighbour], MAPS)
    expect(withoutFrame).toHaveLength(1)
    expect(withoutFrame[withoutFrame.length - 1].source).toBe('neighbour')

    const results = new Map<MapId, WindowMatch | null>([[MAP_A, { x: 0, y: 0, score: 0.95 }]])
    const withFrame: RingSearch = { order: [MAP_A], depth: 1, results }
    const suggestions = suggestPlacement(withFrame, cap, [neighbour], MAPS)
    expect(suggestions[suggestions.length - 1].source).toBe('neighbour')
    expect(suggestions[0].source).toBe('frame')
  })
})
