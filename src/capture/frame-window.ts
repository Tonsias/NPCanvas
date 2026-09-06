import type { CaptureProfile, PixelRect } from '../project/types.ts'
import { luminanceAt } from './glyph-matcher.ts'

const BYTES_PER_PIXEL = 4

// The dialogue box draws its own border directly above `textRect` — those native rows are box
// chrome, not map graphics, so the usable window stops this far short of the text box.
const TEXT_BOX_BORDER = 8

// Generous enough to survive a smoothing shader's anti-aliasing and a GBC-vs-DMG palette swap
// (see #165) while still tripping on an actual tile boundary — a luminance step no real dithering
// produces on its own.
const EDGE_THRESHOLD = 24

// In **native** pixels, spanning the profile's full width — everything above the text box (less
// its own border) is map, whatever the profile.
export function frameWindowRect(profile: CaptureProfile): PixelRect {
  const height = Math.min(
    profile.nativeHeight,
    Math.max(0, profile.textRect.y - TEXT_BOX_BORDER),
  )
  return { x: 0, y: 0, width: profile.nativeWidth, height }
}

// `pixels` is a flat RGBA buffer, the shape `getImageData` returns — row-major, `width * height * 4`
// bytes. Structure, not colour: a pixel is an edge when it differs from its right or lower
// neighbour, which survives a shader and a palette swap that colour comparisons don't.
export function edgeMask(pixels: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      const offset = index * BYTES_PER_PIXEL
      const luminance = luminanceAt(pixels, offset)
      const rightEdge =
        x + 1 < width && Math.abs(luminance - luminanceAt(pixels, offset + BYTES_PER_PIXEL)) > EDGE_THRESHOLD
      const lowerEdge =
        y + 1 < height &&
        Math.abs(luminance - luminanceAt(pixels, offset + width * BYTES_PER_PIXEL)) > EDGE_THRESHOLD
      mask[index] = rightEdge || lowerEdge ? 1 : 0
    }
  }
  return mask
}
