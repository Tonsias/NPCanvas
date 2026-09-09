import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { selectDialogue } from '../app/select.ts'
import { resolveZones, zoneLabel } from '../dialogue-row/dialogue-summary.ts'
import { npcKey, npcLabel } from '../insights/filters.ts'
import { dispatch } from '../project/store.ts'
import type { Dialogue, DialogueId, Zone, ZoneId } from '../project/types.ts'
import { Icon } from '../app/Icon.tsx'
import './DialogueReferences.css'

// One list, because `Dialogue.references` is symmetric: a link reads the same from either end, so
// splitting it into "points at" and "pointed at by" would show the same partner twice. Removing
// from here removes both halves — see the reducer's `setEdge`. The partner is picked by a click
// on its own pin rather than a search list — a name in a dropdown says nothing about where on the
// map it is, which is the whole reason to be looking at the canvas already.
export function DialogueReferences({
  dialogue,
  dialogues,
  zonesById,
  zoneIndex,
  picking,
  onStartPick,
  onCancelPick,
}: {
  dialogue: Dialogue
  dialogues: readonly Dialogue[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  /** True while the canvas is armed and waiting for a click to name this dialogue's partner. */
  picking: boolean
  onStartPick: (dialogueId: DialogueId) => void
  onCancelPick: () => void
}): ReactElement {
  const dialogueId = dialogue.id
  const linked = useMemo(
    () =>
      dialogue.references.flatMap((id) => {
        const target = dialogues.find((candidate) => candidate.id === id)
        return target === undefined ? [] : [target]
      }),
    [dialogue.references, dialogues],
  )

  return (
    <section className="dialogue-references dialogue-panel__section">
      <h3 className="micro-label">Linked lines</h3>
      {linked.length === 0 ? (
        <p className="dialogue-references__empty hint-text">Linked to nothing yet.</p>
      ) : (
        <ul className="dialogue-references__list">
          {linked.map((target) => (
            <li key={target.id} className="dialogue-references__item">
              <ReferenceRow target={target} zonesById={zonesById} zoneIndex={zoneIndex} />
              <button
                type="button"
                className="button"
                aria-label={`Unlink ${npcLabel(npcKey(target))}`}
                title="Unlink"
                onClick={() =>
                  dispatch({
                    kind: 'dialogue/reference-removed',
                    dialogueId,
                    referenceId: target.id,
                  })
                }
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {picking ? (
        <div className="dialogue-references__picking" role="status">
          <p className="dialogue-references__picking-hint hint-text">
            Click the pin it should link to…
          </p>
          <button
            type="button"
            className="button"
            aria-label="Cancel"
            title="Cancel"
            onClick={onCancelPick}
          >
            <Icon name="close" />
          </button>
        </div>
      ) : (
        <button type="button" className="button" onClick={() => onStartPick(dialogueId)}>
          Link another line…
        </button>
      )}
    </section>
  )
}

function ReferenceRow({
  target,
  zonesById,
  zoneIndex,
}: {
  target: Dialogue
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
}): ReactElement {
  const zones = resolveZones(target.id, zoneIndex, zonesById)
  const label = target.npcName.trim() === '' ? 'Unnamed NPC' : target.npcName.trim()
  return (
    <button
      type="button"
      className="dialogue-references__link"
      onClick={() => selectDialogue(target.id)}
    >
      {label}
      {zones.length > 0 && (
        <span className="dialogue-references__where"> — {zones.map(zoneLabel).join(', ')}</span>
      )}
    </button>
  )
}
