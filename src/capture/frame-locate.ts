// One window scored against one map — no ring, no choice between maps (#167 owns both). See #166.

// An edge mask (`frame-window.ts`'s `edgeMask`) plus the dimensions it was built at.
export type FrameMask = {
  readonly width: number
  readonly height: number
  readonly mask: Uint8Array
}

export type WindowMatch = { x: number; y: number; score: number }

// Fraction of the **best possible** overlap for the pair (`min(windowW, mapW) * min(windowH,
// mapH)`), never of the window — a 128x128 house pads the frame on every side, so requiring the
// window to fit inside the map would exclude every house, mart and small shop by construction.
export const MIN_OVERLAP = 0.9

// Measured over 272 hand-placed lines in the test project (#166): at 0.88/0.04 margin, 91/272 fire, all 91 land on the right map, median 10 px off.
export const LOCATE_ACCEPT = 0.88

// Paired with LOCATE_ACCEPT: the gap over the runner-up map's score #167 requires before trusting the winner.
export const LOCATE_MARGIN = 0.04

const COARSE_FACTOR = 8
const REFINE_RADIUS = 8
const REFINE_CANDIDATES = 8

// `x`/`y` are the window's top-left in **map-image pixels** and may be negative — a map smaller
// than the window sits inside the frame, not the other way round. `null` only when no offset meets
// `MIN_OVERLAP` at all, never because of the map's size alone.
export function locateWindow(window: FrameMask, map: FrameMask): WindowMatch | null {
  const coarseWindow = downscale(window, COARSE_FACTOR)
  const coarseMap = downscale(map, COARSE_FACTOR)
  const coarseCandidates = bestOffsets(coarseWindow, coarseMap, REFINE_CANDIDATES)

  // A map this small next to the window collapses to one coarse pixel and can legitimately have no
  // coarse candidate — fall back to scoring every offset directly rather than a false `null`.
  if (coarseCandidates.length === 0) return bestOffsets(window, map, 1)[0] ?? null

  let best: WindowMatch | null = null
  for (const candidate of coarseCandidates) {
    const centerX = candidate.x * COARSE_FACTOR
    const centerY = candidate.y * COARSE_FACTOR
    for (let y = centerY - REFINE_RADIUS; y <= centerY + REFINE_RADIUS; y++) {
      for (let x = centerX - REFINE_RADIUS; x <= centerX + REFINE_RADIUS; x++) {
        const score = scoreAt(window, map, x, y)
        if (score !== null && (best === null || score > best.score)) best = { x, y, score }
      }
    }
  }
  return best
}

// Every offset whose overlap clears `MIN_OVERLAP`, kept if among the `count` best — serves both the
// coarse pass and the full-resolution refinement, just at whatever scale its masks were built at.
function bestOffsets(window: FrameMask, map: FrameMask, count: number): WindowMatch[] {
  const minX = -window.width + 1
  const maxX = map.width - 1
  const minY = -window.height + 1
  const maxY = map.height - 1

  const top: WindowMatch[] = []
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const score = scoreAt(window, map, x, y)
      if (score === null) continue
      insertTop(top, { x, y, score }, count)
    }
  }
  return top
}

function insertTop(top: WindowMatch[], candidate: WindowMatch, limit: number): void {
  let index = 0
  while (index < top.length && top[index].score >= candidate.score) index++
  if (index >= limit) return
  top.splice(index, 0, candidate)
  if (top.length > limit) top.length = limit
}

// `null` below `MIN_OVERLAP`; otherwise the plain fraction of overlapping pixels whose edge bit
// agrees — no trimming, no per-tile weighting.
function scoreAt(window: FrameMask, map: FrameMask, x: number, y: number): number | null {
  const left = Math.max(x, 0)
  const top = Math.max(y, 0)
  const right = Math.min(x + window.width, map.width)
  const bottom = Math.min(y + window.height, map.height)
  const overlapWidth = right - left
  const overlapHeight = bottom - top
  if (overlapWidth <= 0 || overlapHeight <= 0) return null

  const overlapArea = overlapWidth * overlapHeight
  const bestPossible = Math.min(window.width, map.width) * Math.min(window.height, map.height)
  if (overlapArea < MIN_OVERLAP * bestPossible) return null

  let agree = 0
  for (let row = 0; row < overlapHeight; row++) {
    const mapRow = (top + row) * map.width
    const windowRow = (top + row - y) * window.width
    for (let column = 0; column < overlapWidth; column++) {
      const mapBit = map.mask[mapRow + left + column]
      const windowBit = window.mask[windowRow + left + column - x]
      if (mapBit === windowBit) agree++
    }
  }
  return agree / overlapArea
}

// Subsamples at `factor`'s stride rather than averaging — the mask is binary, and averaging edge
// bits would invent fractional values a real edge never has.
function downscale(frame: FrameMask, factor: number): FrameMask {
  const width = Math.max(1, Math.ceil(frame.width / factor))
  const height = Math.max(1, Math.ceil(frame.height / factor))
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(frame.height - 1, y * factor)
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(frame.width - 1, x * factor)
      mask[y * width + x] = frame.mask[sourceY * frame.width + sourceX]
    }
  }
  return { width, height, mask }
}
