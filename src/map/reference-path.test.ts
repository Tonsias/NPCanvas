import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId } from '../project/ids.ts'
import type { Dialogue, GameMap, MapId, Point } from '../project/types.ts'
import { referenceEdges } from './reference-path.ts'

const HARBOUR = asMapId('harbour')
const CAVES = asMapId('caves')

function gameMap(id: MapId, origin: Point, scale = 1): GameMap {
  return {
    id,
    name: id,
    file: { fileName: `${id}.png`, mimeType: 'image/png', byteSize: 1 },
    width: 100,
    height: 100,
    origin,
    scale,
  }
}

function dialogue(
  id: string,
  mapId: MapId,
  position: Point,
  references: string[] = [],
): Dialogue {
  return {
    id: asDialogueId(id),
    mapId,
    npcName: id,
    position,
    text: '',
    media: [],
    spokenAt: '2026-08-15T10:00:00.000Z',
    relevance: [],
    references: references.map(asDialogueId),
  }
}

const AT_ORIGIN = gameMap(HARBOUR, { x: 0, y: 0 })
const OFFSET = gameMap(CAVES, { x: 500, y: 40 })

describe('referenceEdges', () => {
  it('is empty when nothing points at anything', () => {
    const a = dialogue('a', HARBOUR, { x: 1, y: 1 })
    expect(referenceEdges([AT_ORIGIN], [a])).toEqual([])
  })

  it('draws an edge across two maps, in canvas space', () => {
    const target = dialogue('target', CAVES, { x: 10, y: 20 })
    const source = dialogue('source', HARBOUR, { x: 10, y: 20 }, ['target'])

    expect(referenceEdges([AT_ORIGIN, OFFSET], [source, target])).toEqual([
      {
        from: source.id,
        to: target.id,
        fromPoint: { x: 10, y: 20 },
        toPoint: { x: 510, y: 60 },
      },
    ])
  })

  it('drops an edge whose target dialogue is gone', () => {
    const source = dialogue('source', HARBOUR, { x: 1, y: 1 }, ['gone'])
    expect(referenceEdges([AT_ORIGIN], [source])).toEqual([])
  })

  it('drops an edge whose source map is not on the canvas', () => {
    const target = dialogue('target', HARBOUR, { x: 1, y: 1 })
    const source = dialogue('source', CAVES, { x: 1, y: 1 }, ['target'])
    expect(referenceEdges([AT_ORIGIN], [source, target])).toEqual([])
  })

  it('drops an edge whose target map is not on the canvas', () => {
    const target = dialogue('target', CAVES, { x: 1, y: 1 })
    const source = dialogue('source', HARBOUR, { x: 1, y: 1 }, ['target'])
    expect(referenceEdges([AT_ORIGIN], [source, target])).toEqual([])
  })

  it('draws one edge per reference, for a line linked to several others', () => {
    const first = dialogue('first', HARBOUR, { x: 1, y: 1 }, ['source'])
    const second = dialogue('second', HARBOUR, { x: 2, y: 2 }, ['source'])
    const source = dialogue('source', HARBOUR, { x: 0, y: 0 }, ['first', 'second'])

    const edges = referenceEdges([AT_ORIGIN], [source, first, second])
    expect(edges.map((edge) => edge.to)).toEqual([first.id, second.id])
  })

  it('draws one line for a symmetric link, not one per stored half', () => {
    const target = dialogue('target', HARBOUR, { x: 10, y: 20 }, ['source'])
    const source = dialogue('source', HARBOUR, { x: 0, y: 0 }, ['target'])

    const edges = referenceEdges([AT_ORIGIN], [source, target])
    expect(edges).toHaveLength(1)
    expect(edges[0].from).toBe(source.id)
    expect(edges[0].to).toBe(target.id)
  })
})
