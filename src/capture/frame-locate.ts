// One window scored against one map — no ring, no choice between maps (#167 owns both). See #166.

// An edge mask (`frame-window.ts`'s `edgeMask`) plus the dimensions it was built at.
export type FrameMask = {
  readonly width: number
  readonly height: number
  readonly mask: Uint8Array
}

// A mask packed for search: one bit per pixel, plus the blocks worth comparing at all.
export type LocateMask = {
  readonly width: number
  readonly height: number
  readonly stride: number
  readonly edge: Uint32Array
  readonly valid: Uint32Array
}

export type WindowMatch = { x: number; y: number; score: number }

// Fraction of the pair's **best possible** overlap (`min(windowW, mapW) * min(windowH, mapH)`),
// never of the window: a 128x128 house pads the frame on every side, and requiring the window to
// fit inside the map would exclude every house, mart and shop by construction.
export const MIN_OVERLAP = 0.9

// Two blocks of agreement in a corner must not outrank a whole screen of matching map: an offset
// sharing less than this fraction of the best possible overlap in *valid* pixels is no candidate.
const MIN_VALID = 0.15

// With LOCATE_MARGIN, over 417 placed lines (#171): 0.92 calls a winner on a third of them and is
// right 99.3% of those, against 98.2% at 0.88 — a wrong "confident" costs more than a silent one.
export const LOCATE_ACCEPT = 0.92

// Paired with LOCATE_ACCEPT: the gap over the runner-up map's score #167 requires before trusting the winner.
export const LOCATE_MARGIN = 0.04

// A tile, and the search's stride: a console holds its camera on the tile grid whenever a dialogue
// can start and a rip is drawn on that grid, so the true offset was a multiple of this in 173 of
// the 175 lines an exhaustive search placed correctly (#171). A pixel pass around the best coarse
// matches was measured too, and landed no closer to the hand-set pins while costing two lines
// their place in the top three — searching between tiles buys peaks that are not there.
export const LOCATE_STEP = 8

const WORD_BITS = 32

function packBits(mask: Uint8Array, width: number, height: number, stride: number): Uint32Array {
  const words = new Uint32Array(stride * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) words[y * stride + (x >> 5)] |= 1 << (x & 31)
    }
  }
  return words
}

// A block with no edge in it is flat colour — a screen's black surround past a small room, or a
// rip's empty filler. Neither says which map this is, and counting them as agreement is what let a
// mostly-black frame match every interior alike.
export function prepareMask(frame: FrameMask): LocateMask {
  const { width, height, mask } = frame
  const valid = new Uint8Array(width * height)
  for (let blockY = 0; blockY < height; blockY += LOCATE_STEP) {
    const bottom = Math.min(blockY + LOCATE_STEP, height)
    for (let blockX = 0; blockX < width; blockX += LOCATE_STEP) {
      const right = Math.min(blockX + LOCATE_STEP, width)
      let edges = 0
      for (let y = blockY; y < bottom; y++) {
        for (let x = blockX; x < right; x++) edges += mask[y * width + x]
      }
      if (edges === 0) continue
      for (let y = blockY; y < bottom; y++) valid.fill(1, y * width + blockX, y * width + right)
    }
  }
  const stride = Math.ceil(width / WORD_BITS)
  return { width, height, stride, edge: packBits(mask, width, height, stride), valid: packBits(valid, width, height, stride) }
}

function popcount(value: number): number {
  let bits = value - ((value >>> 1) & 0x55555555)
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333)
  bits = (bits + (bits >>> 4)) & 0x0f0f0f0f
  return (bits * 0x01010101) >>> 24
}

// `x`/`y` are the window's top-left in **map-image pixels** and may be negative — a map smaller
// than the window sits inside the frame, not the other way round. `null` only when no offset meets
// `MIN_OVERLAP` and `MIN_VALID`, never because of the map's size alone.
export function locateWindow(window: LocateMask, map: LocateMask): WindowMatch | null {
  // Multiples of the stride, not of wherever the scan starts: the grid is the point of striding.
  const fromX = alignDown(-window.width + 1)
  const fromY = alignDown(-window.height + 1)

  const bestPossible = Math.min(window.width, map.width) * Math.min(window.height, map.height)
  const minArea = MIN_OVERLAP * bestPossible
  const minValid = MIN_VALID * bestPossible
  const shiftStride = window.stride + 1
  const shiftedEdge = new Uint32Array(shiftStride * window.height)
  const shiftedValid = new Uint32Array(shiftStride * window.height)
  let best: WindowMatch | null = null

  for (let x = fromX; x <= map.width - 1; x += LOCATE_STEP) {
    const left = Math.max(x, 0)
    const right = Math.min(x + window.width, map.width)
    const overlapWidth = right - left
    if (overlapWidth <= 0 || overlapWidth * Math.min(window.height, map.height) < minArea) continue

    // Shifted into the map's word alignment and clipped to this offset's columns — both depend on
    // x alone, so they are paid once per column rather than once per offset.
    const base = x >> 5
    const shift = x - (base << 5)
    const firstWord = Math.max(0, -base)
    const lastWord = Math.min(shiftStride - 1, map.stride - 1 - base)
    if (lastWord < firstWord) continue
    shiftedEdge.fill(0)
    shiftedValid.fill(0)
    for (let word = firstWord; word <= lastWord; word++) {
      const wordStart = (base + word) * WORD_BITS
      let keep = 0xffffffff
      if (wordStart < left || wordStart + WORD_BITS > right) {
        keep = 0
        for (let bit = 0; bit < WORD_BITS; bit++) {
          const column = wordStart + bit
          if (column >= left && column < right) keep |= 1 << bit
        }
      }
      for (let row = 0; row < window.height; row++) {
        const source = row * window.stride
        const low = word < window.stride ? source + word : -1
        const high = word > 0 ? source + word - 1 : -1
        const edge = shiftInto(window.edge, low, high, shift)
        const valid = shiftInto(window.valid, low, high, shift)
        shiftedEdge[row * shiftStride + word] = (edge & keep) >>> 0
        shiftedValid[row * shiftStride + word] = (valid & keep) >>> 0
      }
    }

    for (let y = fromY; y <= map.height - 1; y += LOCATE_STEP) {
      const top = Math.max(y, 0)
      const bottom = Math.min(y + window.height, map.height)
      const overlapHeight = bottom - top
      if (overlapHeight <= 0 || overlapWidth * overlapHeight < minArea) continue

      let comparable = 0
      let windowValid = 0
      let agree = 0
      for (let row = top; row < bottom; row++) {
        const shifted = (row - y) * shiftStride
        const mapRow = row * map.stride + base
        for (let word = firstWord; word <= lastWord; word++) {
          const own = shiftedValid[shifted + word]
          if (own === 0) continue
          windowValid += popcount(own)
          const shared = (own & map.valid[mapRow + word]) >>> 0
          if (shared === 0) continue
          comparable += popcount(shared)
          agree += popcount((~(shiftedEdge[shifted + word] ^ map.edge[mapRow + word]) & shared) >>> 0)
        }
      }
      if (comparable < minValid || windowValid === 0) continue

      // How much of the *screen* this map explains, not how well the shared part happens to agree:
      // covering a corner perfectly must not outrank covering the whole frame well.
      const score = agree / windowValid
      if (best === null || score > best.score) best = { x, y, score }
    }
  }
  return best
}

function alignDown(value: number): number {
  return Math.floor(value / LOCATE_STEP) * LOCATE_STEP
}

function shiftInto(words: Uint32Array, low: number, high: number, shift: number): number {
  const lowBits = low === -1 ? 0 : words[low]
  if (shift === 0) return lowBits
  const highBits = high === -1 ? 0 : words[high]
  return ((lowBits << shift) | (highBits >>> (WORD_BITS - shift))) >>> 0
}
