import { describe, expect, it } from 'vitest'
import {
  LOCATE_ACCEPT,
  LOCATE_MARGIN,
  MIN_OVERLAP,
  locateWindow,
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

// Written independently of `frame-locate.ts`'s coarse-to-fine search — the test that matters is
// that the shortcut finds the same peak as scoring every valid offset directly.
function exhaustiveLocate(window: FrameMask, map: FrameMask): WindowMatch | null {
  let best: WindowMatch | null = null
  for (let y = -window.height + 1; y <= map.height - 1; y++) {
    for (let x = -window.width + 1; x <= map.width - 1; x++) {
      const left = Math.max(x, 0)
      const top = Math.max(y, 0)
      const right = Math.min(x + window.width, map.width)
      const bottom = Math.min(y + window.height, map.height)
      const overlapWidth = right - left
      const overlapHeight = bottom - top
      if (overlapWidth <= 0 || overlapHeight <= 0) continue

      const overlapArea = overlapWidth * overlapHeight
      const bestPossible = Math.min(window.width, map.width) * Math.min(window.height, map.height)
      if (overlapArea < MIN_OVERLAP * bestPossible) continue

      let agree = 0
      for (let row = 0; row < overlapHeight; row++) {
        for (let column = 0; column < overlapWidth; column++) {
          const mapBit = map.mask[(top + row) * map.width + left + column]
          const windowBit = window.mask[(top + row - y) * window.width + left + column - x]
          if (mapBit === windowBit) agree++
        }
      }
      const score = agree / overlapArea
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
    const map = randomMask(24, 20, 7)
    const window = crop(map, 5, 4, 10, 8)

    expect(locateWindow(window, map)).toEqual({ x: 5, y: 4, score: 1 })
  })

  it('still wins its true position with one tile overwritten', () => {
    const map = randomMask(24, 20, 7)
    const window = flip(crop(map, 5, 4, 10, 8), 3, 3)

    expect(locateWindow(window, map)).toEqual({ x: 5, y: 4, score: 79 / 80 })
  })

  it('matches at a negative offset when the map is smaller than the window in both axes', () => {
    const small = randomMask(6, 5, 3)
    const big = new Uint8Array(12 * 10)
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 6; column++) {
        big[(3 + row) * 12 + (4 + column)] = small.mask[row * 6 + column]
      }
    }
    const window: FrameMask = { width: 12, height: 10, mask: big }

    expect(locateWindow(window, small)).toEqual({ x: -4, y: -3, score: 1 })
  })

  it('matches a window wider than a map that is itself taller than the window', () => {
    // Mirrors the 160x96-window-vs-128x128-house case (#166): the map is narrower than the window
    // but taller, so the window can never sit fully inside the map — only `MIN_OVERLAP` against the
    // best-possible overlap makes this placement valid at all.
    const map = randomMask(6, 8, 21)
    const filler = randomMask(10, 6, 99)
    const window = new Uint8Array(filler.mask)
    for (let row = 0; row < 6; row++) {
      for (let column = 0; column < 6; column++) {
        window[row * 10 + (2 + column)] = map.mask[(1 + row) * 6 + column]
      }
    }

    expect(locateWindow({ width: 10, height: 6, mask: window }, map)).toEqual({
      x: -2,
      y: 1,
      score: 1,
    })
  })

  it('rejects a window that only half-hangs off a map, even where that half matches perfectly', () => {
    // A uniform map with a window that is real structure on one side and blank on the other: the
    // blank side alone would score a perfect match, but its overlap never clears `MIN_OVERLAP`, so
    // that position must never be the winner.
    const map: FrameMask = { width: 12, height: 4, mask: new Uint8Array(12 * 4) }
    const windowBits = new Uint8Array(10 * 4)
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 10; column++) {
        windowBits[row * 10 + column] = column < 6 ? 1 : 0
      }
    }
    const window: FrameMask = { width: 10, height: 4, mask: windowBits }

    const match = locateWindow(window, map)
    expect(match).not.toBeNull()
    expect(match?.score).toBeLessThan(1)
    expect(match?.x).toBeGreaterThanOrEqual(-1)
    expect(match?.x).toBeLessThanOrEqual(3)
  })

  it('returns a score that does not clear LOCATE_ACCEPT against a uniform map', () => {
    const map: FrameMask = { width: 20, height: 16, mask: new Uint8Array(20 * 16) }
    const window = randomMask(10, 8, 11)

    const match = locateWindow(window, map)
    expect(match).not.toBeNull()
    expect(match?.score).toBeLessThan(LOCATE_ACCEPT)
  })

  it('finds the same peak as an exhaustive search over every valid offset', () => {
    const fixtures: { window: FrameMask; map: FrameMask }[] = [
      { map: randomMask(24, 20, 7), window: crop(randomMask(24, 20, 7), 5, 4, 10, 8) },
      { map: randomMask(24, 20, 7), window: flip(crop(randomMask(24, 20, 7), 5, 4, 10, 8), 3, 3) },
      { map: randomMask(40, 32, 42), window: crop(randomMask(40, 32, 42), 18, 9, 14, 10) },
    ]

    for (const { window, map } of fixtures) {
      expect(locateWindow(window, map)).toEqual(exhaustiveLocate(window, map))
    }
  })
})
