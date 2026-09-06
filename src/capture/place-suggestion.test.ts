import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asPendingCaptureId } from '../project/ids.ts'
import type { Dialogue, GameMap, MapId, PendingCapture } from '../project/types.ts'
import type { WindowMatch } from './frame-locate.ts'
import {
  isConfident,
  mapsToScore,
  orderCandidateMaps,
  PLAYER_IN_WINDOW,
  RING_DEPTH_DEFAULT,
  RING_DEPTH_STEP,
  suggestFromNeighbour,
  suggestPlacement,
  topCandidates,
  withResults,
  type MapCandidate,
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

describe('orderCandidateMaps', () => {
  it('returns the document order when from is null', () => {
    const maps = [gameMap('a', { x: 0, y: 0 }, 100), gameMap('b', { x: 500, y: 0 }, 100)]
    expect(orderCandidateMaps(null, maps)).toEqual([maps[0].id, maps[1].id])
  })

  it('puts touching maps at gap zero, from first', () => {
    const from = gameMap('a', { x: 0, y: 0 }, 100)
    const touching = gameMap('b', { x: 100, y: 0 }, 100)
    const far = gameMap('c', { x: 1000, y: 0 }, 100)
    expect(orderCandidateMaps(from, [far, from, touching])).toEqual([from.id, touching.id, far.id])
  })

  it('gives a map inside another map\'s bounds gap zero', () => {
    const from = gameMap('a', { x: 0, y: 0 }, 100)
    const inside = gameMap('b', { x: 10, y: 10 }, 10)
    const far = gameMap('c', { x: 1000, y: 0 }, 100)
    expect(orderCandidateMaps(from, [far, from, inside])).toEqual([from.id, inside.id, far.id])
  })

  it('ranks by rectangle gap, not centre distance, for a large map', () => {
    const from = gameMap('a', { x: 0, y: 0 }, 100)
    // big's centre sits far away, but its edge is only 50 units past `from` — closer by gap than
    // small, whose centre is nearer but whose edge is 200 units past `from`.
    const big = gameMap('big', { x: 150, y: 0 }, 1000)
    const small = gameMap('small', { x: 300, y: 0 }, 10)
    expect(orderCandidateMaps(from, [small, from, big])).toEqual([from.id, big.id, small.id])
  })

  it('keeps a 128x128 map among large ones as an ordinary candidate', () => {
    const from = gameMap('a', { x: 0, y: 0 }, 100)
    const house = gameMap('house', { x: 300, y: 0 }, 128)
    const city = gameMap('city', { x: 900, y: 0 }, 640)
    expect(orderCandidateMaps(from, [from, house, city])).toEqual([from.id, house.id, city.id])
  })

  it('is total and stable: the same inputs give the same order', () => {
    const from = gameMap('a', { x: 0, y: 0 }, 100)
    const maps = [gameMap('b', { x: 300, y: 0 }, 50), from, gameMap('c', { x: 300, y: 0 }, 50)]
    expect(orderCandidateMaps(from, maps)).toEqual(orderCandidateMaps(from, [...maps]))
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
  it('orders by score descending', () => {
    const results = new Map<MapId, WindowMatch | null>([
      [asMapId('low'), { x: 0, y: 0, score: 0.2 }],
      [asMapId('high'), { x: 0, y: 0, score: 0.9 }],
      [asMapId('mid'), { x: 0, y: 0, score: 0.5 }],
    ])
    const search: RingSearch = { order: [...results.keys()], depth: results.size, results }
    const top = topCandidates(search, 3)
    expect(top.map((candidate) => candidate.mapId)).toEqual([asMapId('high'), asMapId('mid'), asMapId('low')])
  })

  it('breaks a tie by ring order', () => {
    const results = new Map<MapId, WindowMatch | null>([
      [asMapId('near'), { x: 0, y: 0, score: 0.7 }],
      [asMapId('far'), { x: 0, y: 0, score: 0.7 }],
    ])
    const search: RingSearch = { order: [...results.keys()], depth: results.size, results }
    expect(topCandidates(search, 2).map((candidate) => candidate.mapId)).toEqual([
      asMapId('near'),
      asMapId('far'),
    ])
  })

  it('skips maps with no match and limits to n', () => {
    const results = new Map<MapId, WindowMatch | null>([
      [asMapId('none'), null],
      [asMapId('a'), { x: 0, y: 0, score: 0.6 }],
      [asMapId('b'), { x: 0, y: 0, score: 0.8 }],
    ])
    const search: RingSearch = { order: [...results.keys()], depth: results.size, results }
    expect(topCandidates(search, 1)).toEqual([
      { mapId: asMapId('b'), position: { x: PLAYER_IN_WINDOW.x, y: PLAYER_IN_WINDOW.y }, score: 0.8 },
    ])
  })

  it('adds PLAYER_IN_WINDOW to the located origin, including a negative one', () => {
    const results = new Map<MapId, WindowMatch | null>([[asMapId('a'), { x: -30, y: -12, score: 0.9 }]])
    const search: RingSearch = { order: [...results.keys()], depth: 1, results }
    expect(topCandidates(search, 1)[0].position).toEqual({
      x: -30 + PLAYER_IN_WINDOW.x,
      y: -12 + PLAYER_IN_WINDOW.y,
    })
  })
})

describe('isConfident', () => {
  const candidate = (score: number): MapCandidate => ({ mapId: asMapId('a'), position: { x: 0, y: 0 }, score })

  it('is false below LOCATE_ACCEPT regardless of margin', () => {
    expect(isConfident(candidate(0.87), null)).toBe(false)
    expect(isConfident(candidate(0.87), candidate(0.5))).toBe(false)
  })

  it('is true at LOCATE_ACCEPT with no runner-up', () => {
    expect(isConfident(candidate(0.88), null)).toBe(true)
  })

  it('is false when the runner-up is within LOCATE_MARGIN', () => {
    expect(isConfident(candidate(0.9), candidate(0.87))).toBe(false)
  })

  it('is true when the runner-up is beyond LOCATE_MARGIN', () => {
    expect(isConfident(candidate(0.92), candidate(0.87))).toBe(true)
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
