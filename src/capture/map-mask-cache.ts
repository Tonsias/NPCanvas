import { acquireMediaUrl, releaseMediaUrl } from '../media/media-url-cache.ts'
import type { GameMap, MapId, MediaFile, PixelRect } from '../project/types.ts'
import type { FrameMask } from './frame-locate.ts'
import { edgeMask } from './frame-window.ts'

// `createImageBitmap` on the blob -> a 2D context created with `{ willReadFrequently: true }` ->
// `getImageData` -> `edgeMask` (CLAUDE.md's decode pipeline), shared by a map's own picture and a
// capture's frame window. `rect` crops before the edge pass — a map is masked whole, while a
// capture's picture is the whole console screen and only the part above the text box is map
// (`frame-window.ts`'s `frameWindowRect`). The object URL comes from `media-url-cache.ts` and is
// always released, even on a decode failure.
export async function decodeMask(file: MediaFile, rect?: PixelRect): Promise<FrameMask | null> {
  const url = await acquireMediaUrl(file)
  try {
    if (url.kind !== 'ready') return null
    const blob = await (await fetch(url.url)).blob()
    const bitmap = await createImageBitmap(blob)
    try {
      const width = rect?.width ?? bitmap.width
      const height = rect?.height ?? bitmap.height
      if (width <= 0 || height <= 0) return null

      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) return null
      context.drawImage(bitmap, -(rect?.x ?? 0), -(rect?.y ?? 0))

      const pixels = context.getImageData(0, 0, width, height)
      return { width, height, mask: edgeMask(pixels.data, width, height) }
    } finally {
      bitmap.close()
    }
  } finally {
    releaseMediaUrl(file)
  }
}

// Keyed on `MapId` **and** `file.fileName` — a re-imported map keeps its id, and would otherwise
// be served a stale mask forever (#168). A map that only moves keeps its file name, so a drag
// never triggers a redecode. A failed decode is never cached, so a file that is momentarily
// unreadable (folder reconnect still pending) gets retried on the next press rather than stuck.
const cache = new Map<MapId, { fileName: string; mask: FrameMask }>()

export async function mapMask(map: GameMap): Promise<FrameMask | null> {
  const cached = cache.get(map.id)
  if (cached !== undefined && cached.fileName === map.file.fileName) return cached.mask

  const mask = await decodeMask(map.file)
  if (mask !== null) cache.set(map.id, { fileName: map.file.fileName, mask })
  return mask
}
