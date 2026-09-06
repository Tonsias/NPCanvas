import { dialoguesByTimeAsc } from '../dialogue/dialogue-order.ts'
import { toLocalDateTimeValue } from '../dialogue/local-datetime.ts'
import { mapCanvasRect } from '../map/canvas-layout.ts'
import type { Rect } from '../map/geometry.ts'
import type { CaptureProfile, Dialogue, GameMap, MapId, PendingCapture, Point } from '../project/types.ts'
import { LOCATE_ACCEPT, LOCATE_MARGIN, locateWindow } from './frame-locate.ts'
import type { FrameMask, WindowMatch } from './frame-locate.ts'
import { frameWindowRect } from './frame-window.ts'
import { decodeMask, mapMask } from './map-mask-cache.ts'

type PlaceSource = 'frame' | 'neighbour'

export type PlaceSuggestion = {
  mapId: MapId
  position: Point
  source: PlaceSource
  confidence: number
  reason: string
}

const NEIGHBOUR_CONFIDENCE = 0.5

// Depth needed to contain the right map, measured over 272 hand-placed lines (#167): 1 -> 76.5%,
// 4 -> 89.0%, 8 -> 94.1%, 12 -> 97.1%, 16 -> 99.6%, 24 -> 100%. 12 is the knee, a default not a
// limit — every candidate is scored, so depth is linear in cost.
export const RING_DEPTH_DEFAULT = 12
export const RING_DEPTH_STEP = 12

// Centre of the native 160x144 screen: the camera keeps the player fixed there, and
// frameWindowRect only ever crops from the bottom (the text box), so this holds for every profile.
export const PLAYER_IN_WINDOW: Point = { x: 80, y: 72 }

const SUGGESTION_COUNT = 3

// Zero when the rects touch or overlap; the distance between the nearest edges otherwise. Never
// centre distance, which would push a large map away by its own size.
function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width))
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height))
  return Math.hypot(dx, dy)
}

// `from` first, then the rest by ascending rectangle gap; filters nothing by size (#166 can match
// a map smaller than a game screen). Array.prototype.sort is stable, so a gap tie keeps `maps`'
// own order — the same inputs always give the same list.
export function orderCandidateMaps(from: GameMap | null, maps: readonly GameMap[]): readonly MapId[] {
  if (from === null) return maps.map((map) => map.id)
  const fromRect = mapCanvasRect(from)
  const rest = maps.filter((map) => map.id !== from.id)
  const byGap = rest
    .map((map) => ({ id: map.id, gap: rectGap(fromRect, mapCanvasRect(map)) }))
    .sort((a, b) => a.gap - b.gap)
  return [from.id, ...byGap.map((entry) => entry.id)]
}

// The candidate order, how deep it has been scored, and each scored map's result (`null` where
// `locateWindow` found nothing) keyed by `MapId`.
export type RingSearch = {
  order: readonly MapId[]
  depth: number
  results: ReadonlyMap<MapId, WindowMatch | null>
}

// Only the ids between the depth already scored and the requested one — empty when the
// requested depth did not grow, so a caller never re-asks for a map it already scored.
export function mapsToScore(search: RingSearch, depth: number): readonly MapId[] {
  if (depth <= search.depth) return []
  return search.order.slice(search.depth, Math.min(depth, search.order.length))
}

// Folds `results` for exactly the newly-scored ids (from `mapsToScore`) into a new `RingSearch`;
// a map already scored is never revisited even if `results` carries an entry for it.
export function withResults(
  search: RingSearch,
  depth: number,
  results: ReadonlyMap<MapId, WindowMatch | null>,
): RingSearch {
  const toScore = mapsToScore(search, depth)
  const merged = new Map(search.results)
  for (const id of toScore) merged.set(id, results.get(id) ?? null)
  return { order: search.order, depth: search.depth + toScore.length, results: merged }
}

// Profile is found back by matching the capture's size against `profile.nativeWidth/nativeHeight`
// (`PendingCapture` carries no profile id). Same-console profiles can share a size while disagreeing
// on the text box, so ties use the narrowest window — a non-map profile scores low everywhere
// regardless, and a real map loses nothing by extra cropping. `null` with no picture or no match.
async function captureWindowMask(
  capture: PendingCapture,
  profiles: readonly CaptureProfile[],
): Promise<FrameMask | null> {
  const media = capture.media[0]
  if (media === undefined) return null
  const matches = profiles.filter(
    (candidate) => candidate.nativeWidth === media.width && candidate.nativeHeight === media.height,
  )
  if (matches.length === 0) return null
  const rect = matches
    .map(frameWindowRect)
    .reduce((narrowest, candidate) => (candidate.height < narrowest.height ? candidate : narrowest))
  return decodeMask(media.file, rect)
}

// Shared body of a first search and a widen (#170), so neither re-decodes a map the other scored.
async function scoreAgainstWindow(
  ids: readonly MapId[],
  windowMask: FrameMask,
  maps: readonly GameMap[],
): Promise<ReadonlyMap<MapId, WindowMatch | null>> {
  const scored = await Promise.all(
    ids.map(async (mapId): Promise<readonly [MapId, WindowMatch | null]> => {
      const map = maps.find((candidate) => candidate.id === mapId)
      const mask = map === undefined ? null : await mapMask(map)
      return [mapId, mask === null ? null : locateWindow(windowMask, mask)]
    }),
  )
  return new Map(scored)
}

// Scores the maps inside `RING_DEPTH_DEFAULT` of `order` against `capture`'s own frame — the
// wiring #167 left undone. No decode and no search at all when the capture has no picture, so a
// press over a capture with nothing to look at never touches the mask cache.
export async function buildRingSearch(
  capture: PendingCapture,
  maps: readonly GameMap[],
  profiles: readonly CaptureProfile[],
  from: GameMap | null,
): Promise<RingSearch> {
  const order = orderCandidateMaps(from, maps)
  const depth = Math.min(RING_DEPTH_DEFAULT, order.length)
  const toScore = order.slice(0, depth)

  const windowMask = await captureWindowMask(capture, profiles)
  const results =
    windowMask === null ? new Map<MapId, WindowMatch | null>() : await scoreAgainstWindow(toScore, windowMask, maps)

  return { order, depth, results }
}

// #170: widens `search` to `depth` via `mapsToScore`/`withResults`, scoring only the new slice.
export async function widenRingSearch(
  search: RingSearch,
  capture: PendingCapture,
  maps: readonly GameMap[],
  profiles: readonly CaptureProfile[],
  depth: number,
): Promise<RingSearch> {
  const toScore = mapsToScore(search, depth)
  if (toScore.length === 0) return search

  const windowMask = await captureWindowMask(capture, profiles)
  const results =
    windowMask === null
      ? new Map<MapId, WindowMatch | null>(toScore.map((id) => [id, null]))
      : await scoreAgainstWindow(toScore, windowMask, maps)

  return withResults(search, depth, results)
}

export type MapCandidate = {
  mapId: MapId
  position: Point
  score: number
}

// Descending by score, ties broken by ring order (Map iteration order follows `mapsToScore`'s
// slices, and Array.prototype.sort is stable) — the nearer map wins a tie.
export function topCandidates(search: RingSearch, n: number): readonly MapCandidate[] {
  const candidates: MapCandidate[] = []
  for (const [mapId, match] of search.results) {
    if (match === null) continue
    candidates.push({
      mapId,
      position: { x: match.x + PLAYER_IN_WINDOW.x, y: match.y + PLAYER_IN_WINDOW.y },
      score: match.score,
    })
  }
  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, n)
}

// True only when `candidate` clears LOCATE_ACCEPT and beats `runnerUp` — a **different** map's
// score, never a second peak on the same one, since `RingSearch.results` holds one score per map.
export function isConfident(candidate: MapCandidate, runnerUp: MapCandidate | null): boolean {
  if (candidate.score < LOCATE_ACCEPT) return false
  if (runnerUp === null) return true
  return candidate.score - runnerUp.score > LOCATE_MARGIN
}

function frameReason(map: GameMap | undefined, score: number): string {
  const name = map?.name ?? 'an unnamed map'
  return `Picture match on ${name}, score ${score.toFixed(2)}`
}

// The frame candidates ranked, then the clock's guess (#163) as a final, labelled entry — so the
// list is never empty while any dialogue is placed, whatever the picture search found.
export function suggestPlacement(
  search: RingSearch,
  capture: PendingCapture,
  dialogues: readonly Dialogue[],
  maps: readonly GameMap[],
): readonly PlaceSuggestion[] {
  const candidates = topCandidates(search, SUGGESTION_COUNT)
  const runnerUp = candidates[1] ?? null
  const suggestions: PlaceSuggestion[] = candidates.map((candidate, index) => {
    const map = maps.find((candidateMap) => candidateMap.id === candidate.mapId)
    const confident = index === 0 && isConfident(candidate, runnerUp)
    return {
      mapId: candidate.mapId,
      position: candidate.position,
      source: 'frame',
      confidence: confident ? 1 : candidate.score,
      reason: frameReason(map, candidate.score),
    }
  })

  const neighbour = suggestFromNeighbour(capture, dialogues, maps)
  if (neighbour !== null) suggestions.push(neighbour)
  return suggestions
}

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
