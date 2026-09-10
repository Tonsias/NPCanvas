import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../app/Icon.tsx'
import { formatRoute } from '../app/route.ts'
import { formatSpokenAt, resolveZones } from '../dialogue-row/dialogue-summary.ts'
import { MediaGallery } from '../media/MediaGallery.tsx'
import { resolveGalleryIndex, stepGalleryIndex } from '../media/gallery-index.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import type { Dialogue, DialogueId, MediaId, Zone, ZoneId } from '../project/types.ts'
import { ZoneChips } from './ZoneChips.tsx'

/** The NPC's lines paged one at a time, the shape `MediaGallery` pages pictures in — listing them
 * all made the panel as long as the NPC was talkative, and the chips above narrow instead. */
export function NpcLines({
  dialogues,
  label,
  zonesById,
  zoneIndex,
}: {
  dialogues: readonly Dialogue[]
  label: string
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
}): ReactElement {
  const [currentId, setCurrentId] = useState<DialogueId | null>(null)
  const index = resolveGalleryIndex(dialogues, currentId)
  const current = dialogues[index]
  const tickRef = useRef<HTMLButtonElement | null>(null)

  // block: 'nearest' so paging never drags the page vertically — only the strip's own overflow.
  useEffect(() => {
    tickRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [index])

  if (current === undefined) {
    return <p className="insights__empty hint-text">No line of theirs matches those chips.</p>
  }

  const paged = dialogues.length > 1

  function page(delta: number): void {
    const next = dialogues[stepGalleryIndex(index, delta, dialogues.length)]
    if (next !== undefined) setCurrentId(next.id)
  }

  // defaultPrevented: the line's own MediaGallery is nested inside this container and pages on
  // the same two keys, so a picture step must not also step the line.
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!paged || event.defaultPrevented || isTextFieldFocused()) return
    if (event.key === 'ArrowLeft') page(-1)
    else if (event.key === 'ArrowRight') page(1)
    else return
    event.preventDefault()
  }

  return (
    <div className="npc-lines" onKeyDown={onKeyDown}>
      <NpcLine
        // Remounts on every step, so a new line starts at its own first picture.
        key={current.id}
        dialogue={current}
        label={label}
        zones={resolveZones(current.id, zoneIndex, zonesById)}
      />

      {paged && (
        <div className="npc-lines__bar">
          <button
            type="button"
            className="button"
            aria-label="Previous line"
            title="Previous line"
            disabled={index === 0}
            onClick={() => page(-1)}
          >
            <Icon name="chevron-left" />
          </button>
          <p className="npc-lines__count hint-text" role="status">
            Line {index + 1} of {dialogues.length}
          </p>
          <button
            type="button"
            className="button"
            aria-label="Next line"
            title="Next line"
            disabled={index === dialogues.length - 1}
            onClick={() => page(1)}
          >
            <Icon name="chevron-right" />
          </button>
        </div>
      )}

      {paged && (
        <div className="npc-lines__strip">
          {dialogues.map((dialogue, position) => (
            <button
              key={dialogue.id}
              ref={position === index ? tickRef : null}
              type="button"
              className="npc-lines__tick"
              aria-current={position === index ? 'true' : undefined}
              aria-label={`Line ${position + 1}, ${formatSpokenAt(dialogue.spokenAt)}`}
              title={formatSpokenAt(dialogue.spokenAt)}
              onClick={() => setCurrentId(dialogue.id)}
            >
              {position + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NpcLine({
  dialogue,
  label,
  zones,
}: {
  dialogue: Dialogue
  label: string
  zones: readonly Zone[]
}): ReactElement {
  const [currentMediaId, setCurrentMediaId] = useState<MediaId | null>(null)
  const said = dialogue.text.trim()
  return (
    <article className="npc-line">
      <header className="npc-line__head">
        <time className="dialogue-row__when" dateTime={dialogue.spokenAt}>
          {formatSpokenAt(dialogue.spokenAt)}
        </time>
        <span className="dialogue-row__where">
          <ZoneChips zones={zones} nowhereClassName="dialogue-row__nowhere" />
        </span>
        <a
          className="npc-line__link"
          href={formatRoute({
            kind: 'canvas',
            dialogueId: dialogue.id,
            focus: { kind: 'map', id: dialogue.mapId },
          })}
        >
          Show on canvas
        </a>
      </header>
      {said !== '' && <p className="npc-line__text">{dialogue.text}</p>}
      {/* No reorder/remove here — "Show on canvas" is the way to the panel that can edit media. */}
      <MediaGallery
        media={dialogue.media}
        label={label}
        selectedId={currentMediaId}
        onSelect={setCurrentMediaId}
      />
      {said === '' && dialogue.media.length === 0 && (
        <p className="npc-line__empty hint-text">No text yet</p>
      )}
    </article>
  )
}
