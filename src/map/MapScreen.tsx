import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Route } from '../app/route.ts'
import { navigate } from '../app/route.ts'
import { RovingRadioGroup } from '../app/RovingRadioGroup.tsx'
import { clearSelection } from '../app/select.ts'
import type { CanvasViewState } from '../app/view-state.ts'
import { CanvasLegend } from '../dialogue/CanvasLegend.tsx'
import { DialoguePanel } from '../dialogue/DialoguePanel.tsx'
import type { PlaceSuggestion, RingSearch } from '../capture/place-suggestion.ts'
import {
  assumeAnchor,
  buildRingSearch,
  placementTrail,
  RING_DEPTH_STEP,
  suggestPlacement,
  widenRingSearch,
} from '../capture/place-suggestion.ts'
import { resolveGalleryIndex } from '../media/gallery-index.ts'
import { byId, questIndexFor } from '../project/derived.ts'
import { newDialogueId } from '../project/ids.ts'
import { dispatch } from '../project/store.ts'
import { dialoguesInAnyQuest } from '../quest/quest-index.ts'
import type {
  CanvasTool,
  Dialogue,
  DialogueId,
  GameMap,
  MapId,
  PendingCaptureId,
  ProjectFile,
  RelevanceTagId,
  Selection,
  Zone,
} from '../project/types.ts'
import { CanvasDisplayDialog } from './CanvasDisplayDialog.tsx'
import { CapturesPanel } from './CapturesPanel.tsx'
import type { Rect } from './geometry.ts'
import type { MapDragPreview, ZoneDragPreview } from './MapCanvas.tsx'
import { MapCanvas } from './MapCanvas.tsx'
import type { Viewport } from './viewport.ts'
import { MapImportButton } from './MapImportButton.tsx'
import { MapList } from './MapList.tsx'
import type { PinDragPreview } from './PinLayer.tsx'
import { PinLayer, ProvisionalPin } from './PinLayer.tsx'
import { ReferenceLayer } from './ReferenceLayer.tsx'
import { isTextFieldFocused } from '../text-field-focus.ts'
import { TrailLayer } from './TrailLayer.tsx'
import { ZoneLayer } from './ZoneLayer.tsx'
import { ZoneList } from './ZoneList.tsx'
import {
  countDialoguesByZone,
  dialoguesInZone,
  indexDialoguesByZone,
  reindexMovedZone,
} from './zone-index.ts'
import { Icon } from '../app/Icon.tsx'
import type { IconName } from '../app/Icon.tsx'
import './MapScreen.css'

type CanvasRoute = Extract<Route, { kind: 'canvas' }>

// #169: the next capture's own search, computed while its predecessor's card is still on screen,
// so paging to it shows an answer that is already there. `assumedFromMapId` is the map the
// currently-selected suggestion points at — the ring the real search would use once that
// suggestion is committed — and `maps`/`dialogues` are the document slices it was built against,
// so a change underneath it (a moved, re-imported, or removed map) is caught by reference before
// the result is ever redeemed.
type Precomputed = {
  captureId: PendingCaptureId
  assumedFromMapId: MapId
  maps: readonly GameMap[]
  dialogues: readonly Dialogue[]
  search: RingSearch
}

// The confident top candidate when there is one (baked into `confidence === 1` by
// suggestPlacement), otherwise the clock's guess — so hammering Enter stays safe, and looking
// stays possible. Falls to index 0 (whatever the list starts with) when there is no guess to fall
// back to, which a media-less capture's neighbour-only list already satisfies on its own.
function defaultSuggestionIndex(suggestions: readonly PlaceSuggestion[]): number {
  const confidentIndex = suggestions.findIndex((suggestion) => suggestion.confidence === 1)
  if (confidentIndex !== -1) return confidentIndex
  const guessIndex = suggestions.findIndex((suggestion) => suggestion.source === 'neighbour')
  return guessIndex === -1 ? 0 : guessIndex
}

export function MapScreen({
  project,
  selection,
  route,
  viewState,
  onViewStateChange,
}: {
  project: ProjectFile
  selection: Selection
  route: CanvasRoute
  viewState: CanvasViewState
  onViewStateChange: (update: (prev: CanvasViewState) => CanvasViewState) => void
}): ReactElement {
  // Tool, quest filter and viewport are lifted to App so a switch away and back leaves the
  // canvas as it was. Setters below are stable functional updates, not closures over viewState.
  const { tool, questFilter, trail, references, zonesOpen, mapsOpen, viewport, panelWidth } = viewState

  const [armedCaptureId, setArmedCaptureId] = useState<PendingCaptureId | null>(null)
  const [currentCaptureId, setCurrentCaptureId] = useState<PendingCaptureId | null>(null)
  // A dialog left open across a view switch is not a canvas setting, so this is a local
  // useState rather than a field of CanvasViewState.
  const [displayDialogOpen, setDisplayDialogOpen] = useState(false)
  const setTool = useCallback(
    (tool: CanvasTool) => {
      onViewStateChange((prev) => ({ ...prev, tool }))
      if (tool.kind !== 'place-dialogue') setArmedCaptureId(null)
    },
    [onViewStateChange],
  )
  // A toggle: clicking the already-armed row cancels it; arming another switches to place-dialogue.
  const onArmCapture = useCallback(
    (captureId: PendingCaptureId) => {
      if (armedCaptureId === captureId) {
        setArmedCaptureId(null)
        return
      }
      setArmedCaptureId(captureId)
      setSuggesting(false) // one placement gesture at a time
      setTool({ kind: 'place-dialogue' })
    },
    [armedCaptureId, setTool],
  )

  // #164: a mode, not a one-shot — suggestFromNeighbour only runs while it's on, which is what
  // keeps browsing the carousel as cheap as it is today.
  const [suggesting, setSuggesting] = useState(false)
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0)
  const onToggleSuggest = useCallback(() => {
    setSuggesting((prev) => {
      const next = !prev
      if (next) setArmedCaptureId(null) // one placement gesture at a time
      return next
    })
  }, [])

  // Resolved here, not inside PendingCaptureList, so the suggestion this component computes and
  // the card the sidebar shows never disagree about which capture is "current". Falls to
  // `previousCaptureIndex` — the item that took a just-placed capture's place — rather than the
  // last one, which is the #164 fix to resolveGalleryIndex's old always-last fallback.
  const previousCaptureIndex = useRef<number | null>(null)
  const captureIndex = resolveGalleryIndex(
    project.pendingCaptures,
    currentCaptureId,
    previousCaptureIndex.current,
  )
  previousCaptureIndex.current = captureIndex
  const currentCapture = project.pendingCaptures[captureIndex] ?? null

  // The capture right after the current one in queue order — the same item that will occupy
  // `captureIndex` once the current one is committed (#169). Null past the end of the queue.
  const nextCapture = project.pendingCaptures[captureIndex + 1] ?? null

  // Redeemed by the suggestions effect below exactly once, for exactly the capture it names — a
  // ref rather than state, since consuming it must not itself trigger a redundant re-search.
  const precomputeHandoffRef = useRef<Precomputed | null>(null)

  // Bumped every time the current capture's search restarts — a new capture, entering/leaving
  // suggest mode. #170's widen captures this at press time and checks it again on completion, so
  // a widen still in flight when the card changes is dropped instead of clobbering the new card's
  // search (its own effect below bumps this before starting).
  const searchEpochRef = useRef(0)

  // The ring search behind the current card's candidates (#167 wired in by #168), kept as state
  // (not just its derived suggestions) so #170's widen has something to hand back to `withResults`.
  // Async, so this is built by an effect rather than a useMemo — decoding a map's mask reads a
  // file. `from` is the neighbour's map: the picture search has no notion of "where the player
  // probably still is", so the time-nearest dialogue's map stands in for it.
  const [search, setSearch] = useState<RingSearch | null>(null)
  const [widening, setWidening] = useState(false)
  useEffect(() => {
    searchEpochRef.current += 1
    const epoch = searchEpochRef.current
    setWidening(false)

    if (!suggesting || currentCapture === null) {
      setSearch(null)
      precomputeHandoffRef.current = null
      return
    }
    const capture = currentCapture
    const handoff = precomputeHandoffRef.current
    precomputeHandoffRef.current = null
    if (handoff !== null && handoff.captureId === capture.id) {
      setSearch(handoff.search)
      setSelectedSuggestionIndex(
        defaultSuggestionIndex(suggestPlacement(handoff.search, capture, project.dialogues, project.maps)),
      )
      return
    }
    setSearch(null) // clears a previous capture's stale candidates while this one decodes
    const trail = placementTrail(capture, project.dialogues, project.maps)
    void buildRingSearch(capture, project.maps, project.captureProfiles, trail).then((built) => {
      if (searchEpochRef.current !== epoch) return
      setSearch(built)
      setSelectedSuggestionIndex(
        defaultSuggestionIndex(suggestPlacement(built, capture, project.dialogues, project.maps)),
      )
    })
  }, [suggesting, currentCapture, project.dialogues, project.maps, project.captureProfiles])

  const suggestions = useMemo(
    () =>
      search === null || currentCapture === null
        ? NO_SUGGESTIONS
        : suggestPlacement(search, currentCapture, project.dialogues, project.maps),
    [search, currentCapture, project.dialogues, project.maps],
  )

  const selectedSuggestion = suggestions[selectedSuggestionIndex] ?? null

  // #170: raises the ring depth for the card in hand only — `search` is reset to
  // RING_DEPTH_DEFAULT by the effect above the moment the capture, mode or document changes, so a
  // widened depth never taxes the next capture. Scores only the new slice (`widenRingSearch` calls
  // `mapsToScore`/`withResults` from #167), and prefers a fresh confident match over the previously
  // selected candidate, which is kept only if it still made the new top three.
  const canWiden = search !== null && search.depth < search.order.length
  const onWiden = useCallback(() => {
    if (search === null || currentCapture === null || search.depth >= search.order.length) return
    const capture = currentCapture
    const maps = project.maps
    const dialogues = project.dialogues
    const previousMapId = selectedSuggestion?.mapId ?? null
    const newDepth = Math.min(search.depth + RING_DEPTH_STEP, search.order.length)
    const epoch = searchEpochRef.current
    setWidening(true)
    void widenRingSearch(search, capture, maps, project.captureProfiles, newDepth).then((widened) => {
      if (searchEpochRef.current !== epoch) return
      setWidening(false)
      setSearch(widened)
      const widenedSuggestions = suggestPlacement(widened, capture, dialogues, maps)
      const confidentIndex = widenedSuggestions.findIndex((candidate) => candidate.confidence === 1)
      if (confidentIndex !== -1) {
        setSelectedSuggestionIndex(confidentIndex)
        return
      }
      const keptIndex =
        previousMapId === null
          ? -1
          : widenedSuggestions.findIndex((candidate) => candidate.mapId === previousMapId)
      setSelectedSuggestionIndex(keptIndex !== -1 ? keptIndex : defaultSuggestionIndex(widenedSuggestions))
    })
  }, [search, currentCapture, selectedSuggestion, project.maps, project.dialogues, project.captureProfiles])

  // #169: kept only for the one capture ahead — `nextCapture` is never more than one — and only
  // while its assumption still holds. Depends on `selectedSuggestion`, so changing the highlighted
  // candidate on the current card (1/2/3/g/arrows) restarts the precompute from the newly assumed
  // map, same as committing would; the in-flight search this replaces is cancelled below.
  const [precomputed, setPrecomputed] = useState<Precomputed | null>(null)
  useEffect(() => {
    if (!suggesting || nextCapture === null || selectedSuggestion === null) {
      setPrecomputed(null)
      return
    }
    const capture = nextCapture
    const assumedFromMapId = selectedSuggestion.mapId
    const maps = project.maps
    const dialogues = project.dialogues
    const profiles = project.captureProfiles
    let cancelled = false
    const assumedMap = maps.find((map) => map.id === assumedFromMapId) ?? null
    const trail = placementTrail(capture, dialogues, maps)
    void buildRingSearch(
      capture,
      maps,
      profiles,
      assumedMap === null ? trail : assumeAnchor(assumedMap, selectedSuggestion.position, trail),
    ).then((built) => {
      if (cancelled) return
      setPrecomputed({
        captureId: capture.id,
        assumedFromMapId,
        maps,
        dialogues,
        search: built,
      })
    })
    return () => {
      cancelled = true
    }
  }, [suggesting, nextCapture, selectedSuggestion, project.maps, project.dialogues, project.captureProfiles])

  const onChangeSuggestionIndex = useCallback(
    (index: number) => setSelectedSuggestionIndex(index),
    [],
  )

  const onCommitSuggestion = useCallback(() => {
    if (currentCapture === null || selectedSuggestion === null) return
    const committedMapId = selectedSuggestion.mapId
    // The precompute is only good for the capture that follows this one, and only if it assumed
    // landing on the very map this commit is about to place onto, against the document as it
    // stands right now — otherwise the ring it built starts from a map the real search wouldn't.
    precomputeHandoffRef.current =
      precomputed !== null &&
      precomputed.captureId === nextCapture?.id &&
      precomputed.assumedFromMapId === committedMapId &&
      precomputed.maps === project.maps &&
      precomputed.dialogues === project.dialogues
        ? precomputed
        : null
    dispatch({
      kind: 'pending-capture/placed',
      captureId: currentCapture.id,
      dialogueId: newDialogueId(),
      mapId: committedMapId,
      position: selectedSuggestion.position,
    })
  }, [currentCapture, selectedSuggestion, precomputed, nextCapture, project.maps, project.dialogues])
  // Auto-cancels rather than leaving a dangling arm: closing the panel or selecting elsewhere
  // means there is no longer a "linked lines" list on screen for a resolved click to land in.
  useEffect(() => {
    if (tool.kind !== 'pick-reference') return
    if (selection.kind === 'dialogue' && selection.id === tool.dialogueId) return
    setTool({ kind: 'inspect' })
  }, [tool, selection, setTool])

  const onStartPickReference = useCallback(
    (dialogueId: DialogueId) => setTool({ kind: 'pick-reference', dialogueId }),
    [setTool],
  )
  const onCancelPickReference = useCallback(() => setTool({ kind: 'inspect' }), [setTool])
  const onReferencePicked = useCallback(() => setTool({ kind: 'inspect' }), [setTool])

  const toggleQuestFilter = useCallback(
    () => onViewStateChange((prev) => ({ ...prev, questFilter: !prev.questFilter })),
    [onViewStateChange],
  )
  const toggleTrail = useCallback(
    () => onViewStateChange((prev) => ({ ...prev, trail: !prev.trail })),
    [onViewStateChange],
  )
  const toggleReferences = useCallback(
    () => onViewStateChange((prev) => ({ ...prev, references: !prev.references })),
    [onViewStateChange],
  )
  const setViewport = useCallback(
    (viewport: Viewport) => onViewStateChange((prev) => ({ ...prev, viewport })),
    [onViewStateChange],
  )
  const setPanelWidth = useCallback(
    (panelWidth: number) => onViewStateChange((prev) => ({ ...prev, panelWidth })),
    [onViewStateChange],
  )

  // Read at the moment a resize gesture needs it, not cached — the window can be resized
  // between two drags.
  const bodyRef = useRef<HTMLDivElement>(null)
  const measureAvailableWidth = useCallback(
    () => bodyRef.current?.clientWidth ?? 0,
    [],
  )

  // Distinguishes "selected because it was just placed" (form claims focus) from every other
  // selection path (pin click, link, search — those want the pin itself focused).
  const [autoFocusDialogueId, setAutoFocusDialogueId] = useState<DialogueId | null>(null)
  const onDialoguePlaced = useCallback(
    (dialogueId: DialogueId) => {
      setAutoFocusDialogueId(dialogueId)
      setTool({ kind: 'inspect' }) // a stray next click must not create a second empty record
    },
    [setTool],
  )
  const onAutoFocusConsumed = useCallback(() => setAutoFocusDialogueId(null), [])

  // Read once at DialoguePanel mount, to decide whether it should move focus into itself or
  // leave it on the pin (which PinLayer's onPinSelected already focused).
  const [pinClickId, setPinClickId] = useState<DialogueId | null>(null)
  const onPinSelected = useCallback((dialogueId: DialogueId) => setPinClickId(dialogueId), [])

  // Lives here, above both world-space layers, so the image and its pins move together in the
  // same frame; kept out of the store since it would push a document-shaped update through
  // autosave every pointermove.
  const [mapDrag, setMapDrag] = useState<MapDragPreview | null>(null)
  const [zoneDrag, setZoneDrag] = useState<ZoneDragPreview | null>(null)
  // Narrower reason than mapDrag/zoneDrag: only TrailLayer reads this. PinLayer keeps rendering
  // the dragged pin from its own state so a preview-patched dialogues array never has to rebuild.
  const [pinDrag, setPinDrag] = useState<PinDragPreview | null>(null)
  const [visibleRect, setVisibleRect] = useState<Rect | null>(null)

  // Global, not scoped to the canvas: ToolPicker sits above it in the header bar.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTextFieldFocused()) return
      const entry = TOOLS.find((candidate) => candidate.key === event.key.toLowerCase())
      if (entry === undefined) return
      event.preventDefault()
      setTool(entry.tool)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setTool])

  const placedMaps = useMemo(() => withDragPreview(project.maps, mapDrag), [project.maps, mapDrag])
  const drawnZones = useMemo(
    () => withZonePreview(project.zones, zoneDrag),
    [project.zones, zoneDrag],
  )
  const zonesById = useMemo(() => byId(project.zones), [project.zones])

  // `replace`: focusing is a one-shot intent, not something to keep in history.
  const dialogueId = route.dialogueId
  const onFocusApplied = useCallback(() => {
    navigate({ kind: 'canvas', dialogueId, focus: null }, { replace: true })
  }, [dialogueId])

  // A cold #/canvas?dialogue=<id> load arrives with the store's selection still at none; the
  // hash is the intent, reconciled into the selection here. An unknown id is dropped from the
  // hash instead of left dangling.
  const dialogues = project.dialogues
  useEffect(() => {
    if (dialogueId === null) return
    if (dialogues.some((dialogue) => dialogue.id === dialogueId)) {
      dispatch({ kind: 'selection/set', selection: { kind: 'dialogue', id: dialogueId } })
      return
    }
    navigate({ kind: 'canvas', dialogueId: null, focus: null }, { replace: true })
  }, [dialogueId, dialogues])

  // The other half: writes a dialogue selection back to the route when the route doesn't
  // already carry it. Scoped to 'dialogue' — a zone/map selection has no route representation.
  useEffect(() => {
    if (dialogueId !== null) return
    if (selection.kind !== 'dialogue') return
    navigate({ kind: 'canvas', dialogueId: selection.id, focus: null }, { replace: true })
  }, [dialogueId, selection])

  // Built from the document's own zones and maps, not placedMaps — feeding a per-frame drag
  // array here would force a full rebuild per frame. A moved map reclassifies on release; a
  // zone drag stays live through reindexMovedZone below.
  const documentIndex = useMemo(
    () => indexDialoguesByZone(dialogues, project.zones, project.maps),
    [dialogues, project.zones, project.maps],
  )

  const zoneIndex = useMemo(
    () =>
      zoneDrag === null
        ? documentIndex
        : reindexMovedZone(documentIndex, dialogues, drawnZones, project.maps, zoneDrag.id),
    [documentIndex, dialogues, drawnZones, project.maps, zoneDrag],
  )
  const zoneCounts = useMemo(() => countDialoguesByZone(zoneIndex), [zoneIndex])

  const selectedZoneId = selection.kind === 'zone' ? selection.id : null
  // null, not an empty set, when no zone is selected — "nothing to dim" vs "this zone is empty".
  const insideSelectedZone = useMemo(
    () => (selectedZoneId === null ? null : dialoguesInZone(zoneIndex, selectedZoneId)),
    [zoneIndex, selectedZoneId],
  )

  const questIndex = useMemo(() => questIndexFor(project.quests), [project.quests])
  const questLinked = useMemo(() => dialoguesInAnyQuest(questIndex), [questIndex])

  // Memoized on relevanceTags' identity alone — a PinLayer prop must never change on anything
  // but a real document edit, or its memo boundary stops holding.
  const relevanceHueByTag = useMemo(
    () => new Map<RelevanceTagId, number>(project.relevanceTags.map((tag) => [tag.id, tag.hue])),
    [project.relevanceTags],
  )

  // Intersect, not override — a selected zone and the quest highlight are independent questions.
  const highlighted = useMemo(
    () => intersect(insideSelectedZone, questFilter ? questLinked : null),
    [insideSelectedZone, questFilter, questLinked],
  )

  const selectedDialogue =
    selection.kind === 'dialogue'
      ? (dialogues.find((dialogue) => dialogue.id === selection.id) ?? null)
      : null

  const selectedLocations = useMemo(() => {
    if (selectedDialogue === null) return []
    const zoneIds = zoneIndex.get(selectedDialogue.id) ?? []
    return zoneIds.flatMap((id) => drawnZones.filter((zone) => zone.id === id))
  }, [selectedDialogue, zoneIndex, drawnZones])

  // Deselection and navigation together: the hash carries the open panel.
  const onCloseDialogue = useCallback(() => {
    clearSelection()
  }, [])

  if (project.maps.length === 0) {
    return (
      <section className="map-screen map-screen--empty">
        <div className="map-screen__cta">
          <h1 className="map-screen__title">Import a map</h1>
          <p className="lead-text">
            NPCanvas pins dialogue onto a map image you supply — a screenshot of the in-game
            map is ideal. Its pixel dimensions become the coordinate system for every pin and
            zone, so import it once at the size you want to work at.
          </p>
          <MapImportButton label="Choose a map image" />
        </div>
      </section>
    )
  }

  return (
    <section className="map-screen">
      {displayDialogOpen && (
        <CanvasDisplayDialog
          questFilter={questFilter}
          onToggleQuestFilter={toggleQuestFilter}
          questFilterDisabled={questLinked.size === 0}
          trail={trail}
          onToggleTrail={toggleTrail}
          trailDisabled={project.dialogues.length < 2}
          references={references}
          onToggleReferences={toggleReferences}
          referencesDisabled={!project.dialogues.some((dialogue) => dialogue.references.length > 0)}
          onClose={() => setDisplayDialogOpen(false)}
        />
      )}
      <div className="map-screen__body" ref={bodyRef}>
        <aside className="map-screen__sidebar panel">
          <h1 className="visually-hidden">Canvas</h1>
          <div className="map-screen__tools">
            <div className="map-screen__tools-head">
              <p className="micro-label">Tool</p>
              <button
                type="button"
                className="button"
                aria-label="Display options"
                title="Display options"
                onClick={() => setDisplayDialogOpen(true)}
              >
                <Icon name="sliders" />
              </button>
            </div>
            <ToolPicker tool={tool} onChange={setTool} />
          </div>
          <details
            className="map-list-disclosure"
            open={zonesOpen}
            // Read synchronously, not inside the updater below — currentTarget reverts to null
            // once the native event finishes dispatching, before a setState updater runs.
            onToggle={(event) => {
              const open = event.currentTarget.open
              onViewStateChange((prev) => ({ ...prev, zonesOpen: open }))
            }}
          >
            <summary className="map-list-disclosure__summary micro-label disclosure-summary">
              <span className="map-list-disclosure__chevron" aria-hidden="true" />
              Zones
              <span className="map-list-disclosure__count">{project.zones.length}</span>
            </summary>
            <ZoneList project={project} selectedId={selectedZoneId} counts={zoneCounts} />
          </details>
          <details
            className="map-list-disclosure"
            open={mapsOpen}
            // Read synchronously, not inside the updater below — currentTarget reverts to null
            // once the native event finishes dispatching, before a setState updater runs.
            onToggle={(event) => {
              const open = event.currentTarget.open
              onViewStateChange((prev) => ({ ...prev, mapsOpen: open }))
            }}
          >
            <summary className="map-list-disclosure__summary micro-label disclosure-summary">
              <span className="map-list-disclosure__chevron" aria-hidden="true" />
              Maps
              <span className="map-list-disclosure__count">{project.maps.length}</span>
            </summary>
            <MapList project={project} />
          </details>
          <CanvasLegend relevanceTags={project.relevanceTags} />
        </aside>
        <div className="map-screen__canvas panel">
          <MapCanvas
            maps={placedMaps}
            zones={drawnZones}
            dialogues={project.dialogues}
            selection={selection}
            tool={tool}
            selectedMapId={selection.kind === 'map' ? selection.id : null}
            focus={route.focus}
            onFocusApplied={onFocusApplied}
            onMapDrag={setMapDrag}
            onZoneDrag={setZoneDrag}
            onVisibleRectChange={setVisibleRect}
            onDialoguePlaced={onDialoguePlaced}
            armedCaptureId={armedCaptureId}
            suggestionFocus={selectedSuggestion}
            initialViewport={viewport}
            onViewportChange={setViewport}
          >
            <ZoneLayer
              maps={placedMaps}
              zones={drawnZones}
              selectedId={selectedZoneId}
              visibleRect={visibleRect}
            />
            {trail && (
              <TrailLayer
                maps={placedMaps}
                dialogues={project.dialogues}
                highlighted={highlighted}
                pinDrag={pinDrag}
              />
            )}
            {references && (
              <ReferenceLayer
                maps={placedMaps}
                dialogues={project.dialogues}
                highlighted={highlighted}
                pinDrag={pinDrag}
              />
            )}
            <PinLayer
              maps={placedMaps}
              dialogues={project.dialogues}
              selectedId={selection.kind === 'dialogue' ? selection.id : null}
              highlighted={highlighted}
              questsByDialogue={questIndex}
              relevanceHueByTag={relevanceHueByTag}
              visibleRect={visibleRect}
              suppressFocusId={autoFocusDialogueId}
              pickReferenceFor={tool.kind === 'pick-reference' ? tool.dialogueId : null}
              onReferencePicked={onReferencePicked}
              onPinSelected={onPinSelected}
              onPinDrag={setPinDrag}
            />
            <ProvisionalPin maps={placedMaps} target={selectedSuggestion} />
          </MapCanvas>
        </div>
        {selectedDialogue !== null ? (
          <DialoguePanel
            project={project}
            dialogue={selectedDialogue}
            locations={selectedLocations}
            zonesById={zonesById}
            zoneIndex={zoneIndex}
            onClose={onCloseDialogue}
            autoFocusNpc={autoFocusDialogueId === selectedDialogue.id}
            onAutoFocusConsumed={onAutoFocusConsumed}
            openedFromPin={pinClickId === selectedDialogue.id}
            width={panelWidth}
            onWidthChange={setPanelWidth}
            measureAvailableWidth={measureAvailableWidth}
            pickingReference={tool.kind === 'pick-reference' && tool.dialogueId === selectedDialogue.id}
            onStartPickReference={onStartPickReference}
            onCancelPickReference={onCancelPickReference}
          />
        ) : (
          <CapturesPanel
            project={project}
            armedCaptureId={armedCaptureId}
            onArm={onArmCapture}
            currentCaptureId={currentCaptureId}
            onSelect={setCurrentCaptureId}
            suggesting={suggesting}
            onToggleSuggest={onToggleSuggest}
            suggestions={suggestions}
            selectedSuggestionIndex={selectedSuggestionIndex}
            onChangeSuggestionIndex={onChangeSuggestionIndex}
            onCommitSuggestion={onCommitSuggestion}
            ringDepth={search?.depth ?? 0}
            ringTotal={search?.order.length ?? 0}
            canWiden={canWiden}
            widening={widening}
            onWiden={onWiden}
            width={panelWidth}
            onWidthChange={setPanelWidth}
            measureAvailableWidth={measureAvailableWidth}
          />
        )}
      </div>
    </section>
  )
}

const NO_SUGGESTIONS: readonly PlaceSuggestion[] = []

// Returns the original array when nothing is being dragged — a fresh array every render would
// defeat PinLayer's memo.
function withDragPreview(maps: GameMap[], drag: MapDragPreview | null): readonly GameMap[] {
  if (drag === null) return maps
  return maps.map((map) => (map.id === drag.id ? { ...map, origin: drag.origin } : map))
}

// Returns an operand by reference when it's the only one active, so one filter allocates nothing.
function intersect(
  a: ReadonlySet<DialogueId> | null,
  b: ReadonlySet<DialogueId> | null,
): ReadonlySet<DialogueId> | null {
  if (a === null) return b
  if (b === null) return a
  const both = new Set<DialogueId>()
  for (const id of a) {
    if (b.has(id)) both.add(id)
  }
  return both
}

function withZonePreview(zones: Zone[], drag: ZoneDragPreview | null): readonly Zone[] {
  if (drag === null) return zones
  return zones.map((zone) => (zone.id === drag.id ? { ...zone, polygon: drag.polygon } : zone))
}

// T['id'], not a second type parameter — a key parameter is only inferable from the
// constraint, which lands as `unknown` and throws away the brand.
// `key` is a single unmodified letter — matched by the global listener above and printed by
// ToolPicker's button (#42's "discoverable without documentation").
const TOOLS: readonly { tool: CanvasTool; label: string; hint: string; key: string; icon: IconName }[] = [
  {
    tool: { kind: 'inspect' },
    label: 'Inspect',
    hint: 'Pan the canvas and select pins or zones',
    key: 'i',
    icon: 'pointer',
  },
  {
    tool: { kind: 'place-dialogue' },
    label: 'Place dialogue',
    hint: 'Click a map to log a line',
    key: 'p',
    icon: 'pin-plus',
  },
  {
    tool: { kind: 'draw-zone' },
    label: 'Draw zone',
    hint: 'Drag out a rectangle, drag a zone to move it, or its grips to resize it',
    key: 'z',
    icon: 'polygon',
  },
  {
    tool: { kind: 'move-map' },
    label: 'Move map',
    hint: 'Drag a map to arrange the canvas',
    key: 'm',
    icon: 'move',
  },
]

function ToolPicker({
  tool,
  onChange,
}: {
  tool: CanvasTool
  onChange: (tool: CanvasTool) => void
}): ReactElement {
  return (
    <RovingRadioGroup
      className="tool-picker"
      ariaLabel="Canvas tool"
      orientation="vertical"
      options={TOOLS}
      optionKey={(entry) => entry.tool.kind}
      selectedKey={tool.kind}
      buttonClassName="tool-picker__button"
      onChange={(entry) => onChange(entry.tool)}
      optionTitle={(entry) => `${entry.hint} (${entry.key.toUpperCase()})`}
      renderOption={(entry) => (
        <>
          <Icon name={entry.icon} />
          <span className="tool-picker__label">{entry.label}</span>
          <kbd>{entry.key.toUpperCase()}</kbd>
        </>
      )}
    />
  )
}
