import { describe, expect, it } from 'vitest'
import { indexQuestsByDialogue } from '../quest/quest-index.ts'
import { asDialogueId, asMapId, asQuestId, asRelevanceTagId, asZoneId } from '../project/ids.ts'
import type { Dialogue, Quest } from '../project/types.ts'
import type { DossierFilter } from './dossier-filter.ts'
import { EMPTY_DOSSIER_FILTER, applyDossierFilter, pruneDossierFilter } from './dossier-filter.ts'

const LORE = asRelevanceTagId('lore')
const HINT = asRelevanceTagId('hint')
const DOCKS = asZoneId('docks')
const MARKET = asZoneId('market')
const DEBT = asQuestId('debt')
const ERRAND = asQuestId('errand')

function dialogue(id: string, relevance: Dialogue['relevance']): Dialogue {
  return {
    id: asDialogueId(id),
    mapId: asMapId('harbour'),
    npcName: 'Mara',
    position: { x: 0, y: 0 },
    text: '',
    media: [],
    spokenAt: '2026-08-14T10:00:00.000Z',
    relevance,
    references: [],
  }
}

function quest(id: string, dialogueIds: Dialogue['id'][]): Quest {
  return { id: asQuestId(id), name: id, status: 'open', dialogueIds, note: '', hue: 0 }
}

/** Three lines that differ on every axis a chip can narrow; `bare` is untagged and in no zone. */
const LORED = dialogue('lored', [LORE])
const HINTED = dialogue('hinted', [HINT])
const BARE = dialogue('bare', [])
const LINES = [LORED, HINTED, BARE]
const zoneIndex = new Map([
  [LORED.id, [DOCKS]],
  [HINTED.id, [MARKET]],
])
const questsByDialogue = indexQuestsByDialogue([
  quest('debt', [LORED.id]),
  quest('errand', [HINTED.id, BARE.id]),
])

function apply(filter: Partial<DossierFilter>): string[] {
  const lines = applyDossierFilter(
    LINES,
    { ...EMPTY_DOSSIER_FILTER, ...filter },
    zoneIndex,
    questsByDialogue,
  )
  return lines.map((line) => String(line.id))
}

describe('applyDossierFilter', () => {
  it('keeps everything when nothing is selected', () => {
    expect(apply({})).toEqual(['lored', 'hinted', 'bare'])
  })

  it("ORs values inside one field, 'untagged' among them", () => {
    expect(apply({ relevance: [LORE, 'untagged'] })).toEqual(['lored', 'bare'])
    expect(apply({ zones: [DOCKS] })).toEqual(['lored'])
    expect(apply({ quests: [ERRAND] })).toEqual(['hinted', 'bare'])
  })

  it('ANDs across fields', () => {
    expect(apply({ relevance: [HINT], zones: [MARKET], quests: [ERRAND] })).toEqual(['hinted'])
    expect(apply({ relevance: [HINT], zones: [DOCKS], quests: [ERRAND] })).toEqual([])
  })
})

describe('pruneDossierFilter', () => {
  const offered: DossierFilter = { relevance: [LORE], zones: [DOCKS], quests: [DEBT] }

  it('drops what the next NPC offers no chip for', () => {
    expect(
      pruneDossierFilter({ relevance: [LORE, HINT], zones: [MARKET], quests: [DEBT] }, offered),
    ).toEqual({ relevance: [LORE], zones: [], quests: [DEBT] })
  })

  it('returns the same object when nothing was dropped', () => {
    const filter: DossierFilter = { relevance: [LORE], zones: [DOCKS], quests: [] }
    expect(pruneDossierFilter(filter, offered)).toBe(filter)
  })
})
