import { describe, expect, it } from 'vitest'
import {
  LOCATE_ACCEPT,
  LOCATE_MARGIN,
  LOCATE_STEP,
  MIN_OVERLAP,
  locateWindow,
  prepareMask,
  type FrameMask,
  type WindowMatch,
} from './frame-locate.ts'

// Deterministic PRNG, not `Math.random` — a fixture must reproduce the same mask on every run.
function randomMask(width: number, height: number, seed: number): FrameMask {
  const mask = new Uint8Array(width * height)
  let state = seed
  for (let index = 0; index < mask.length; index++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    mask[index] = state % 3 === 0 ? 1 : 0
  }
  return { width, height, mask }
}

function crop(source: FrameMask, x: number, y: number, width: number, height: number): FrameMask {
  const mask = new Uint8Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      mask[row * width + column] = source.mask[(y + row) * source.width + (x + column)]
    }
  }
  return { width, height, mask }
}

function flip(source: FrameMask, x: number, y: number): FrameMask {
  const mask = new Uint8Array(source.mask)
  const index = y * source.width + x
  mask[index] = mask[index] === 1 ? 0 : 1
  return { width: source.width, height: source.height, mask }
}

function locate(window: FrameMask, map: FrameMask): WindowMatch | null {
  return locateWindow(prepareMask(window), prepareMask(map))
}

// Written independently of `frame-locate.ts` — same two rules (a block with no edge in it is not
// compared; the score is agreement over the window's own valid pixels), scored offset by offset.
function exhaustiveLocate(window: FrameMask, map: FrameMask): WindowMatch | null {
  const blocked = (frame: FrameMask, x: number, y: number): boolean => {
    const blockX = Math.floor(x / LOCATE_STEP) * LOCATE_STEP
    const blockY = Math.floor(y / LOCATE_STEP) * LOCATE_STEP
    for (let row = blockY; row < Math.min(blockY + LOCATE_STEP, frame.height); row++) {
      for (let column = blockX; column < Math.min(blockX + LOCATE_STEP, frame.width); column++) {
        if (frame.mask[row * frame.width + column] === 1) return true
      }
    }
    return false
  }
  const align = (value: number): number => Math.floor(value / LOCATE_STEP) * LOCATE_STEP

  let best: WindowMatch | null = null
  for (let y = align(-window.height + 1); y <= map.height - 1; y += LOCATE_STEP) {
    for (let x = align(-window.width + 1); x <= map.width - 1; x += LOCATE_STEP) {
      const left = Math.max(x, 0)
      const top = Math.max(y, 0)
      const right = Math.min(x + window.width, map.width)
      const bottom = Math.min(y + window.height, map.height)
      const overlapWidth = right - left
      const overlapHeight = bottom - top
      if (overlapWidth <= 0 || overlapHeight <= 0) continue

      const bestPossible = Math.min(window.width, map.width) * Math.min(window.height, map.height)
      if (overlapWidth * overlapHeight < MIN_OVERLAP * bestPossible) continue

      let windowValid = 0
      let comparable = 0
      let agree = 0
      for (let row = top; row < bottom; row++) {
        for (let column = left; column < right; column++) {
          if (!blocked(window, column - x, row - y)) continue
          windowValid++
          if (!blocked(map, column, row)) continue
          comparable++
          if (map.mask[row * map.width + column] === window.mask[(row - y) * window.width + (column - x)]) agree++
        }
      }
      if (windowValid === 0 || comparable < 0.15 * bestPossible) continue
      const score = agree / windowValid
      if (best === null || score > best.score) best = { x, y, score }
    }
  }
  return best
}

describe('locateWindow', () => {
  it('keeps LOCATE_MARGIN below LOCATE_ACCEPT', () => {
    expect(LOCATE_MARGIN).toBeLessThan(LOCATE_ACCEPT)
  })

  it('scores an exact crop 1 at its true position', () => {
    const map = randomMask(32, 24, 7)
    const window = crop(map, 8, 8, 16, 8)

    expect(locate(window, map)).toEqual({ x: 8, y: 8, score: 1 })
  })

  it('still wins its true position with one tile overwritten', () => {
    const map = randomMask(32, 24, 7)
    const window = flip(crop(map, 8, 8, 16, 8), 3, 3)

    const match = locate(window, map)
    expect(match?.x).toBe(8)
    expect(match?.y).toBe(8)
    expect(match?.score).toBeLessThan(1)
  })

  it('matches at a negative offset when the map is smaller than the window in both axes', () => {
    const small = randomMask(8, 8, 3)
    const big = new Uint8Array(24 * 16)
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        big[(8 + row) * 24 + (8 + column)] = small.mask[row * 8 + column]
      }
    }

    expect(locate({ width: 24, height: 16, mask: big }, small)).toEqual({ x: -8, y: -8, score: 1 })
  })

  it('ignores a block with no edge in it, on either side', () => {
    // The window is real structure on the left and flat black on the right, the map only holds the
    // structure. The blank half is what a screen shows past the edge of a small room: it must not
    // count as agreement, and it must not count against the match either.
    const structure = randomMask(16, 8, 5)
    const window = new Uint8Array(32 * 8)
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 16; column++) window[row * 32 + column] = structure.mask[row * 16 + column]
    }
    const map = new Uint8Array(32 * 8)
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 16; column++) map[row * 32 + column] = structure.mask[row * 16 + column]
    }

    expect(locate({ width: 32, height: 8, mask: window }, { width: 32, height: 8, mask: map })).toEqual({
      x: 0,
      y: 0,
      score: 1,
    })
  })

  it('returns null against a map with no structure at all', () => {
    // Every block flat: nothing to compare, so there is no candidate offset — not a perfect score
    // for having agreed about nothing.
    const map: FrameMask = { width: 32, height: 24, mask: new Uint8Array(32 * 24) }
    expect(locate(randomMask(16, 8, 11), map)).toBeNull()
  })

  it('rejects a window that only half-hangs off a map, even where that half matches perfectly', () => {
    const structure = randomMask(16, 8, 13)
    const map = new Uint8Array(32 * 8)
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 16; column++) map[row * 32 + column] = structure.mask[row * 16 + column]
    }
    const match = locate(structure, { width: 32, height: 8, mask: map })
    expect(match).not.toBeNull()
    expect(match?.x).toBe(0)
  })

  it('finds the same peak as an exhaustive search over every offset on the grid', () => {
    const fixtures: { window: FrameMask; map: FrameMask }[] = [
      { map: randomMask(32, 24, 7), window: crop(randomMask(32, 24, 7), 8, 8, 16, 8) },
      { map: randomMask(32, 24, 7), window: flip(crop(randomMask(32, 24, 7), 8, 8, 16, 8), 3, 3) },
      { map: randomMask(48, 40, 42), window: crop(randomMask(48, 40, 42), 16, 8, 24, 16) },
      { map: randomMask(40, 32, 21), window: randomMask(24, 16, 99) },
    ]

    for (const { window, map } of fixtures) {
      expect(locate(window, map)).toEqual(exhaustiveLocate(window, map))
    }
  })
})
