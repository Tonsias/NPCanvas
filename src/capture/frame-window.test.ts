import { describe, expect, it } from 'vitest'
import { asCaptureProfileId } from '../project/ids.ts'
import type { CaptureProfile } from '../project/types.ts'
import { edgeMask, frameWindowRect } from './frame-window.ts'

const YELLOW_PROFILE: CaptureProfile = {
  id: asCaptureProfileId('profile-yellow'),
  name: 'Yellow',
  frameWidth: 1998,
  frameHeight: 1123,
  screenRect: { x: 37.5, y: 91, width: 420, height: 360 },
  nativeWidth: 160,
  nativeHeight: 144,
  textRect: { x: 8, y: 104, width: 144, height: 32 },
}

const POKEDEX_PROFILE: CaptureProfile = {
  ...YELLOW_PROFILE,
  id: asCaptureProfileId('profile-pokedex'),
  name: 'Pokédex',
  textRect: { x: 8, y: 88, width: 144, height: 48 },
}

describe('frameWindowRect', () => {
  it('spans the full native width, above the text box less its border, for the Yellow profile', () => {
    expect(frameWindowRect(YELLOW_PROFILE)).toEqual({ x: 0, y: 0, width: 160, height: 96 })
  })

  it('yields a smaller window for the Pokédex profile, whose text box starts higher', () => {
    expect(frameWindowRect(POKEDEX_PROFILE)).toEqual({ x: 0, y: 0, width: 160, height: 80 })
  })

  it('returns zero height, not negative, when the text box starts at row 0', () => {
    const profile: CaptureProfile = { ...YELLOW_PROFILE, textRect: { ...YELLOW_PROFILE.textRect, y: 0 } }
    expect(frameWindowRect(profile)).toEqual({ x: 0, y: 0, width: 160, height: 0 })
  })
})

function image(width: number, height: number, at: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const luminance = at(x, y)
      data[offset] = luminance
      data[offset + 1] = luminance
      data[offset + 2] = luminance
      data[offset + 3] = 255
    }
  }
  return data
}

describe('edgeMask', () => {
  it('reads all zero from a flat image', () => {
    const pixels = image(4, 3, () => 128)
    expect(edgeMask(pixels, 4, 3)).toEqual(new Uint8Array(12))
  })

  it('forces the last column to zero, since it has no right neighbour to compare', () => {
    // Vertical stripes: every row is identical, so the lower comparison never fires — only the
    // (missing) right comparison could set the last column, and it doesn't count as an edge.
    const pixels = image(3, 2, (x) => (x % 2 === 0 ? 255 : 0))
    // prettier-ignore
    expect(edgeMask(pixels, 3, 2)).toEqual(Uint8Array.from([
      1, 1, 0,
      1, 1, 0,
    ]))
  })

  it('forces the last row to zero, since it has no lower neighbour to compare', () => {
    // Horizontal stripes: every column is identical, so the right comparison never fires — only
    // the (missing) lower comparison could set the last row, and it doesn't count as an edge.
    const pixels = image(2, 3, (_x, y) => (y % 2 === 0 ? 255 : 0))
    // prettier-ignore
    expect(edgeMask(pixels, 2, 3)).toEqual(Uint8Array.from([
      1, 1,
      1, 1,
      0, 0,
    ]))
  })

  it('reads set everywhere but the bottom-right corner from a checkerboard', () => {
    // Every pixel differs from both its right and lower neighbour, so only the one pixel missing
    // both comparisons — the bottom-right corner — reads as no edge.
    const pixels = image(4, 3, (x, y) => ((x + y) % 2 === 0 ? 255 : 0))
    // prettier-ignore
    expect(edgeMask(pixels, 4, 3)).toEqual(Uint8Array.from([
      1, 1, 1, 1,
      1, 1, 1, 1,
      1, 1, 1, 0,
    ]))
  })
})
