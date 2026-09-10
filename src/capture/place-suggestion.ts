import { dialoguesByTimeAsc } from '../dialogue/dialogue-order.ts'
import { toLocalDateTimeValue } from '../dialogue/local-datetime.ts'
import { mapCanvasRect } from '../map/canvas-layout.ts'
import type { CaptureProfile, Dialogue, GameMap, MapId, PendingCapture, Point } from '../project/types.ts'
import { LOCATE_ACCEPT, LOCATE_MARGIN, locateWindow, prepareMask } from './frame-locate.ts'
import type { LocateMask, WindowMatch } from './frame-locate.ts'
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

// Deep enough to contain the right map for 416 of 417 placed lines (#171): 12 -> 404, 24 -> 412,
// 48 -> 416, 96 -> 416. Past 48 the ring only costs.
export const RING_DEPTH_DEFAULT = 48
export const RING_DEPTH_STEP = 48

// Centre of the native 160x144 screen: the camera keeps the player fixed there, and
// frameWindowRect only ever crops from the bottom (the text box), so this holds for every profile.
export const PLAYER_IN_WINDOW: Point = { x: 80, y: 72 }

const SUGGESTION_COUNT = 3

// Where the player was is the strongest single thing known about where they are: over 417 placed
// lines, context alone puts the right map first for 85% of them, the picture alone for 56% (#171).
const TRAIL_LENGTH = 3
const TRAIL_DECAY = 0.6

// Canvas units, and deliberately gentle — a door can lead anywhere on the canvas.
const TRAIL_FALLOFF = 2000
const TRAIL_NEAR_WEIGHT = 0.25
const TRAIL_SAME_MAP_WEIGHT = 0.1

// What the picture may be worth against context, and the separation it must show to be worth it: a
// menu page resembles every map equally badly (0.11 apart) where a real window separates by 0.32.
const PICTURE_WEIGHT = 1.5
const PICTURE_SHARPNESS = 0.2

// Below this a match's *offset* is the best of a bad field, not evidence, so the pin goes where the
// player last stood on that map: 26 px from the hand-set pin at the median rather than 40 (#171).
const POSITION_TRUST = 0.8

// One line already placed, and how hard it pulls: `point` is in canvas space, the one space two
// maps share.
export type PlacementAnchor = { mapId: MapId; point: Point; position: Point; weight: number }

// Ascending time distance, so the nearest line pulls hardest — in both directions, since a capture
// placed out of order still has its session around it and the line after witnesses as well.
export function placementTrail(
  capture: PendingCapture,
  dialogues: readonly Dialogue[],
  maps: readonly GameMap[],
): readonly PlacementAnchor[] {
  const captureTime = Date.parse(capture.spokenAt)
  if (Number.isNaN(captureTime)) return []
  return dialogues
    .map((dialogue) => ({ dialogue, distance: Math.abs(Date.parse(dialogue.spokenAt) - captureTime) }))
    .filter((entry) => !Number.isNaN(entry.distance))
    .sort((a, b) => a.distance - b.distance)
    .flatMap(({ dialogue }) => {
      const map = maps.find((candidate) => candidate.id === dialogue.mapId)
      if (map === undefined) return []
      const rect = mapCanvasRect(map)
      return [{
        mapId: dialogue.mapId,
        point: { x: rect.x + dialogue.position.x * map.scale, y: rect.y + dialogue.position.y * map.scale },
        position: dialogue.position,
      }]
    })
    .slice(0, TRAIL_LENGTH)
    .map((anchor, index) => ({ ...anchor, weight: Math.pow(TRAIL_DECAY, index) }))
}

// #169's precompute assumes the current card lands where it is about to be committed, which is a
// line the document does not hold yet — so that placement goes in front of the real trail, as the
// most recent anchor, and everything behind it shifts one step back.
export function assumeAnchor(
  map: GameMap,
  position: Point,
  trail: readonly PlacementAnchor[],
): readonly PlacementAnchor[] {
  const rect = mapCanvasRect(map)
  const point = { x: rect.x + position.x * map.scale, y: rect.y + position.y * map.scale }
  return [{ mapId: map.id, point, position, weight: 1 }, ...trail.slice(0, TRAIL_LENGTH - 1)].map((anchor, index) => ({
    ...anchor,
    weight: Math.pow(TRAIL_DECAY, index),
  }))
}

// Zero when the point is inside the rectangle; the distance to its nearest edge otherwise.
function pointGap(point: Point, map: GameMap): number {
  const rect = mapCanvasRect(map)
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const dx = point.x < rect.x ? rect.x - point.x : point.x > right ? point.x - right : 0
  const dy = point.y < rect.y ? rect.y - point.y : point.y > bottom ? point.y - bottom : 0
  return Math.hypot(dx, dy)
}

// A bonus, never a penalty: a map the trail has never been near keeps its picture score intact,
// which is what lets a genuine jump — a cut scene, a flight, a door across the world — still win.
export function contextScore(map: GameMap, trail: readonly PlacementAnchor[]): number {
  if (trail.length === 0) return 0
  let total = 0
  let weights = 0
  for (const anchor of trail) {
    weights += anchor.weight
    total += anchor.weight * TRAIL_NEAR_WEIGHT * Math.exp(-pointGap(anchor.point, map) / TRAIL_FALLOFF)
    if (anchor.mapId === map.id) total += anchor.weight * TRAIL_SAME_MAP_WEIGHT
  }
  return total / weights
}

// Descending by context score; ties keep `maps`' own order, since Array.prototype.sort is stable —
// the same inputs always give the same list.
export function orderCandidateMaps(trail: readonly PlacementAnchor[], maps: readonly GameMap[]): readonly MapId[] {
  return maps
    .map((map) => ({ id: map.id, score: contextScore(map, trail) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.id)
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
): Promise<LocateMask | null> {
  const media = capture.media[0]
  if (media === undefined) return null
  const matches = profiles.filter(
    (candidate) => candidate.nativeWidth === media.width && candidate.nativeHeight === media.height,
  )
  if (matches.length === 0) return null
  const rect = matches
    .map(frameWindowRect)
    .reduce((narrowest, candidate) => (candidate.height < narrowest.height ? candidate : narrowest))
  const decoded = await decodeMask(media.file, rect)
  return decoded === null ? null : prepareMask(decoded)
}

// Shared body of a first search and a widen (#170), so neither re-decodes a map the other scored.
async function scoreAgainstWindow(
  ids: readonly MapId[],
  windowMask: LocateMask,
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
  trail: readonly PlacementAnchor[],
): Promise<RingSearch> {
  const order = orderCandidateMaps(trail, maps)
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
  picture: number
}

// How far this frame separates its best map from the field — near zero for a menu page or a
// cutscene, which must not be allowed to outvote a trail that does know something (#171).
function pictureConfidence(scores: readonly number[]): number {
  if (scores.length === 0) return 0
  const sorted = [...scores].sort((a, b) => b - a)
  const median = sorted[Math.floor(sorted.length / 2)]
  return Math.min(1, Math.max(0, (sorted[0] - median) / PICTURE_SHARPNESS))
}

// Where the pin goes on the winning map: the match's own offset while the picture is worth
// trusting, otherwise the trail's own spot on that same map.
function placeOn(mapId: MapId, match: WindowMatch, trail: readonly PlacementAnchor[]): Point {
  if (match.score < POSITION_TRUST) {
    const anchor = trail.find((candidate) => candidate.mapId === mapId)
    if (anchor !== undefined) return anchor.position
  }
  return { x: match.x + PLAYER_IN_WINDOW.x, y: match.y + PLAYER_IN_WINDOW.y }
}

// Descending by the fused score, ties broken by ring order (Map iteration order follows
// `mapsToScore`'s slices, and Array.prototype.sort is stable) — the nearer map wins a tie.
export function topCandidates(
  search: RingSearch,
  trail: readonly PlacementAnchor[],
  maps: readonly GameMap[],
  n: number,
): readonly MapCandidate[] {
  const scored: { mapId: MapId; match: WindowMatch; map: GameMap }[] = []
  for (const [mapId, match] of search.results) {
    const map = maps.find((candidate) => candidate.id === mapId)
    if (match === null || map === undefined) continue
    scored.push({ mapId, match, map })
  }
  const confidence = pictureConfidence(scored.map((entry) => entry.match.score))
  return scored
    .map(({ mapId, match, map }) => ({
      mapId,
      position: placeOn(mapId, match, trail),
      score: PICTURE_WEIGHT * confidence * match.score + contextScore(map, trail),
      picture: match.score,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
}

// True only when `candidate`'s **picture** clears LOCATE_ACCEPT and beats `runnerUp` — a
// **different** map's score, never a second peak on the same one, since `RingSearch.results` holds
// one score per map. Context can order the list, but it can never claim to have recognised a map.
export function isConfident(candidate: MapCandidate, runnerUp: MapCandidate | null): boolean {
  if (candidate.picture < LOCATE_ACCEPT) return false
  if (runnerUp === null) return true
  return candidate.picture - runnerUp.picture > LOCATE_MARGIN
}

function frameReason(map: GameMap | undefined, score: number): string {
  const name = map?.name ?? 'an unnamed map'
  return `Picture match on ${name}, score ${score.toFixed(2)}`
}

// The fused candidates ranked, then the clock's guess (#163) as a final, labelled entry — so the
// list is never empty while any dialogue is placed, whatever the picture search found.
export function suggestPlacement(
  search: RingSearch,
  capture: PendingCapture,
  dialogues: readonly Dialogue[],
  maps: readonly GameMap[],
): readonly PlaceSuggestion[] {
  const trail = placementTrail(capture, dialogues, maps)
  const candidates = topCandidates(search, trail, maps, SUGGESTION_COUNT)
  const runnerUp = candidates[1] ?? null
  const suggestions: PlaceSuggestion[] = candidates.map((candidate, index) => {
    const map = maps.find((candidateMap) => candidateMap.id === candidate.mapId)
    const confident = index === 0 && isConfident(candidate, runnerUp)
    return {
      mapId: candidate.mapId,
      position: candidate.position,
      source: 'frame',
      confidence: confident ? 1 : candidate.picture,
      reason: frameReason(map, candidate.picture),
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
