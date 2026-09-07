import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { useEffect, useRef } from 'react'
import { EditableRowDeleteConfirm } from '../app/EditableRow.tsx'
import { useEditableRow } from '../app/use-editable-row.ts'
import { toLocalDateTimeValue } from '../dialogue/local-datetime.ts'
import { NpcNameInput } from '../dialogue/NpcNameInput.tsx'
import { npcNamesIn, previousRecordFor } from '../dialogue/recency.ts'
import { relevanceNames } from '../dialogue/relevance.ts'
import { RelevancePicker } from '../dialogue/RelevancePicker.tsx'
import { discardMedia } from '../media/discard-media.ts'
import { resolveGalleryIndex, stepGalleryIndex } from '../media/gallery-index.ts'
import { MediaView } from '../media/MediaView.tsx'
import { dispatch } from '../project/store.ts'
import type { PendingCapture, PendingCaptureId, ProjectFile } from '../project/types.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import type { PlaceSuggestion } from './place-suggestion.ts'
import { useWatchState } from './capture-watch.ts'
import { Icon } from '../app/Icon.tsx'
import './PendingCaptureList.css'

// The triage queue, one capture at a time: several waiting conversations are alternatives to page
// between, not a list read top to bottom, so this shows a frame, a `Capture n of m` counter, and
// a thumbnail strip for whichever capture is on screen. The current capture's id lives in
// `MapScreen`, beside `armedCaptureId` — this component holds no state of its own.
export function PendingCaptureList({
  project,
  armedCaptureId,
  onArm,
  currentCaptureId,
  onSelect,
  suggesting,
  onToggleSuggest,
  suggestions,
  selectedSuggestionIndex,
  onChangeSuggestionIndex,
  onCommitSuggestion,
  ringDepth,
  ringTotal,
  canWiden,
  widening,
  onWiden,
}: {
  project: ProjectFile
  armedCaptureId: PendingCaptureId | null
  onArm: (captureId: PendingCaptureId) => void
  currentCaptureId: PendingCaptureId | null
  onSelect: (captureId: PendingCaptureId) => void
  /** Toggled on as a mode, not fired once (#164) — see MapScreen, which owns this state and the
   * suggestion it computes from whichever capture is current. */
  suggesting: boolean
  onToggleSuggest: () => void
  suggestions: readonly PlaceSuggestion[]
  selectedSuggestionIndex: number
  onChangeSuggestionIndex: (index: number) => void
  onCommitSuggestion: () => void
  /** #170: how deep the ring behind `suggestions` has been scored, out of how many candidate maps
   * exist at all — `canWiden` is false once those two meet. */
  ringDepth: number
  ringTotal: number
  canWiden: boolean
  widening: boolean
  onWiden: () => void
}): ReactElement {
  const npcNames = npcNamesIn(project.dialogues)
  const captures = project.pendingCaptures

  const watch = useWatchState()
  const recordingCaptureId = watch.kind === 'watching' ? watch.captureId : null

  const index = resolveGalleryIndex(captures, currentCaptureId)
  const current = captures[index] ?? null
  const paged = captures.length > 1

  // A commit remounts CaptureCard (keyed on capture.id, so the delete confirmation can't survive
  // a page) — that unmounts the button Enter was pressed from and drops focus to <body>, which
  // would stop the next Enter from ever reaching this handler. Focusing the container itself
  // (stable across that remount) keeps "Enter, Enter, Enter to the end of the queue" working.
  const containerRef = useRef<HTMLDivElement>(null)

  // The carousel follows the watcher: a fresh or reopened conversation is the one growing on
  // screen while it is recorded. Only fires again once `recordingCaptureId` changes, which lets
  // paging away by hand afterwards stick.
  useEffect(() => {
    if (recordingCaptureId !== null) onSelect(recordingCaptureId)
  }, [recordingCaptureId, onSelect])

  function page(delta: number): void {
    const next = captures[stepGalleryIndex(index, delta, captures.length)]
    if (next !== undefined) onSelect(next.id)
  }

  // Bound on the container, never on `window` — the sidebar sits beside a canvas that owns the
  // arrow keys (`MapScreen`'s tool shortcuts), the same rule #157 settled for Cinema.
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (isTextFieldFocused()) return

    if (suggesting) {
      if (event.key === 'Enter') {
        onCommitSuggestion()
        containerRef.current?.focus()
        event.preventDefault()
        return
      }
      if (event.key === 'Escape') {
        onToggleSuggest()
        event.preventDefault()
        return
      }
      // 1/2/3 jump straight to a frame candidate by rank; g jumps to the clock's guess — both
      // land on whatever position that entry actually occupies, since a capture with fewer than
      // three frame candidates still keeps the guess as its last entry.
      if (event.key >= '1' && event.key <= '3') {
        const position = Number(event.key) - 1
        if (position < suggestions.length) onChangeSuggestionIndex(position)
        event.preventDefault()
        return
      }
      if (event.key === 'g' || event.key === 'G') {
        const guessIndex = suggestions.findIndex((candidate) => candidate.source === 'neighbour')
        if (guessIndex !== -1) onChangeSuggestionIndex(guessIndex)
        event.preventDefault()
        return
      }
      if (event.key === 'ArrowUp') {
        onChangeSuggestionIndex(stepGalleryIndex(selectedSuggestionIndex, -1, suggestions.length))
        event.preventDefault()
        return
      }
      if (event.key === 'ArrowDown') {
        onChangeSuggestionIndex(stepGalleryIndex(selectedSuggestionIndex, 1, suggestions.length))
        event.preventDefault()
        return
      }
      // #170: widens the ring by RING_DEPTH_STEP and re-ranks. Absent once the whole document has
      // been scored, and ignored mid-widen so a held key can't queue a second one.
      if ((event.key === 'w' || event.key === 'W') && canWiden && !widening) {
        onWiden()
        event.preventDefault()
        return
      }
    }

    if (!paged) return
    if (event.key === 'ArrowLeft') page(-1)
    else if (event.key === 'ArrowRight') page(1)
    else return
    event.preventDefault()
  }

  async function onDeleteConfirmed(capture: PendingCapture): Promise<void> {
    dispatch({ kind: 'pending-capture/deleted', captureId: capture.id })
    await discardMedia(capture.media)
  }

  return (
    <div className="pending-capture-list" tabIndex={-1} ref={containerRef} onKeyDown={onKeyDown}>
      {current === null ? (
        <p className="pending-capture-list__empty hint-text">
          Nothing waiting. Press New capture or Extend last to record a conversation.
        </p>
      ) : (
        <CaptureCard
          // Keyed so the delete confirmation cannot survive a page to a different capture.
          key={current.id}
          project={project}
          capture={current}
          captures={captures}
          index={index}
          paged={paged}
          npcNames={npcNames}
          armed={armedCaptureId === current.id}
          recording={recordingCaptureId === current.id}
          onArm={() => onArm(current.id)}
          onSelect={onSelect}
          onDeleteConfirmed={() => onDeleteConfirmed(current)}
          suggesting={suggesting}
          onToggleSuggest={onToggleSuggest}
          suggestions={suggestions}
          selectedSuggestionIndex={selectedSuggestionIndex}
          onChangeSuggestionIndex={onChangeSuggestionIndex}
          ringDepth={ringDepth}
          ringTotal={ringTotal}
          canWiden={canWiden}
          widening={widening}
          onWiden={onWiden}
        />
      )}
    </div>
  )
}

function CaptureCard({
  project,
  capture,
  captures,
  index,
  paged,
  npcNames,
  armed,
  recording,
  onArm,
  onSelect,
  onDeleteConfirmed,
  suggesting,
  onToggleSuggest,
  suggestions,
  selectedSuggestionIndex,
  onChangeSuggestionIndex,
  ringDepth,
  ringTotal,
  canWiden,
  widening,
  onWiden,
}: {
  project: ProjectFile
  capture: PendingCapture
  captures: readonly PendingCapture[]
  index: number
  paged: boolean
  npcNames: readonly string[]
  armed: boolean
  recording: boolean
  onArm: () => void
  onSelect: (captureId: PendingCaptureId) => void
  onDeleteConfirmed: () => void
  suggesting: boolean
  onToggleSuggest: () => void
  suggestions: readonly PlaceSuggestion[]
  selectedSuggestionIndex: number
  onChangeSuggestionIndex: (index: number) => void
  ringDepth: number
  ringTotal: number
  canWiden: boolean
  widening: boolean
  onWiden: () => void
}): ReactElement {
  const editable = useEditableRow()
  const firstMedium = capture.media[0] ?? null
  // The most recently recorded other capture, offered as a one-click carry-over — in record
  // order, not paging order, so a reader who has paged elsewhere still gets the right one.
  const previous = previousRecordFor(project.pendingCaptures, capture.id)
  const previousHasSomething =
    previous !== null && (previous.npcName.trim() !== '' || previous.relevance.length > 0)

  return (
    <div
      className="pending-capture-list__row card"
      data-armed={armed ? 'true' : undefined}
      data-recording={recording ? 'true' : undefined}
    >
      <div className="pending-capture-list__frame">
        {firstMedium === null ? (
          <span className="pending-capture-list__no-picture">No picture</span>
        ) : (
          <MediaView media={firstMedium} label="First picture of this conversation" fit="fill" />
        )}
      </div>
      <p className="pending-capture-list__line">
        {capture.text.trim() === '' ? 'No line yet' : capture.text}
      </p>
      <p className="pending-capture-list__spoken-at hint-text">{toLocalDateTimeValue(capture.spokenAt)}</p>

      {paged && (
        <p className="pending-capture-list__count hint-text" role="status">
          Capture {index + 1} of {captures.length}
        </p>
      )}

      {paged && (
        <div className="pending-capture-list__strip">
          {captures.map((candidate, position) => (
            <button
              key={candidate.id}
              type="button"
              className="pending-capture-list__thumb strip-thumb"
              aria-current={candidate.id === capture.id ? 'true' : undefined}
              aria-label={`Capture ${position + 1}`}
              onClick={() => onSelect(candidate.id)}
            >
              <span className="pending-capture-list__thumb-media" inert>
                {candidate.media[0] === undefined ? (
                  <span className="pending-capture-list__thumb-empty">No picture</span>
                ) : (
                  <MediaView media={candidate.media[0]} label="" />
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      <NpcNameInput
        id={`pending-capture-${capture.id}-npc`}
        value={capture.npcName}
        names={npcNames}
        onChange={(npcName) => dispatch({ kind: 'pending-capture/renamed', captureId: capture.id, npcName })}
        onBlur={() => {}}
      />

      {previousHasSomething && (
        <button
          type="button"
          className="pending-capture-list__carry-over"
          onClick={() => {
            dispatch({
              kind: 'pending-capture/renamed',
              captureId: capture.id,
              npcName: previous.npcName,
            })
            dispatch({
              kind: 'pending-capture/relevance-set',
              captureId: capture.id,
              relevance: previous.relevance,
            })
          }}
        >
          Same as {previous.npcName.trim() === '' ? 'the previous capture' : previous.npcName}
          {previous.relevance.length > 0 &&
            `: ${relevanceNames(previous.relevance, project.relevanceTags).join(', ')}`}
        </button>
      )}

      <RelevancePicker
        tags={project.relevanceTags}
        value={capture.relevance}
        onChange={(relevance) =>
          dispatch({ kind: 'pending-capture/relevance-set', captureId: capture.id, relevance })
        }
      />

      {suggesting && (
        <div className="pending-capture-list__suggestion">
          {suggestions.length === 0 ? (
            <p className="pending-capture-list__suggestion-empty hint-text">
              No suggestion yet — nothing else is logged to place this near.
            </p>
          ) : (
            <ul className="pending-capture-list__suggestion-candidates">
              {suggestions.map((candidate, position) => (
                <li key={position}>
                  <button
                    type="button"
                    className="pending-capture-list__suggestion-candidate"
                    aria-current={position === selectedSuggestionIndex ? 'true' : undefined}
                    onClick={() => onChangeSuggestionIndex(position)}
                  >
                    <span className="pending-capture-list__suggestion-text">{candidate.reason}</span>
                    {candidate.source === 'neighbour' && (
                      <span className="pending-capture-list__suggestion-guess-tag">guess</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {ringTotal > 0 && (
            <div className="pending-capture-list__suggestion-ring">
              <p className="pending-capture-list__suggestion-ring-status hint-text" role="status">
                {widening
                  ? 'Widening…'
                  : `Searched ${ringDepth} of ${ringTotal} map${ringTotal === 1 ? '' : 's'}`}
              </p>
              {canWiden && (
                <button
                  type="button"
                  className="button pending-capture-list__suggestion-widen"
                  disabled={widening}
                  onClick={onWiden}
                  aria-label="Widen search"
                  title="Search further out and re-rank (w)"
                >
                  <Icon name="search" />
                </button>
              )}
            </div>
          )}
          <p className="pending-capture-list__suggestion-hint hint-text">
            1/2/3 or g to pick{canWiden ? ' · w to widen the search' : ''} · Enter to place here ·
            Escape to stop suggesting
          </p>
        </div>
      )}

      <div className="pending-capture-list__actions">
        <button
          type="button"
          className="button"
          aria-pressed={armed}
          data-armed={armed ? 'true' : undefined}
          onClick={onArm}
          title={
            armed
              ? 'Cancel — click a map, or Place on map again to stop'
              : 'Click a map to place this conversation there'
          }
        >
          {armed ? 'Placing… click a map' : 'Place on map'}
        </button>
        <button
          type="button"
          className="button"
          aria-pressed={suggesting}
          data-armed={suggesting ? 'true' : undefined}
          onClick={onToggleSuggest}
          title={
            suggesting
              ? 'Stop suggesting a placement'
              : 'Suggest where this conversation belongs, walk the queue with Enter'
          }
        >
          {suggesting ? 'Suggesting…' : 'Suggest placement'}
        </button>
        {editable.mode === 'delete' ? (
          <EditableRowDeleteConfirm
            message="Delete this capture and its pictures?"
            onConfirm={onDeleteConfirmed}
            close={editable.close}
            className="pending-capture-list__confirm"
          />
        ) : (
          <button
            type="button"
            className="button"
            aria-label="Delete this capture"
            title="Delete"
            onClick={editable.openDelete}
          >
            <Icon name="trash" />
          </button>
        )}
      </div>
    </div>
  )
}
