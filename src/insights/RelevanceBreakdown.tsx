import type { ReactElement } from 'react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Disclosure } from '../app/Disclosure.tsx'
import type { Dialogue, DialogueId, RelevanceTag, Zone, ZoneId } from '../project/types.ts'
import { useChartWidth } from './chart-width.ts'
import type { DialogueFilter, ZoneScope } from './filters.ts'
import { NO_ZONE, npcKey, npcLabel } from './filters.ts'
import { SegmentDefs, SegmentFill, SegmentLegend, UNKNOWN_FILL } from './SegmentLegend.tsx'
import type { SegmentKey, Tally } from './relevance-segments.ts'
import { emptyTally, segmentColor, segmentKeys, segmentLabel, segmentRun, tally, totalOf } from './relevance-segments.ts'

type RowTarget =
  | { kind: 'zones'; zones: readonly ZoneScope[] }
  | { kind: 'npcs'; npcKeys: readonly string[] }

type BreakdownRow = {
  key: string
  label: string
  dialogues: number
  counts: Map<SegmentKey, number>
  target: RowTarget
}

const ROW_LIMIT = 15

// Both charts read the filtered dialogues, so clicking a segment drills down rather than
// showing a chart of something the rest of the screen isn't looking at.
export function RelevanceBreakdown({
  dialogues,
  zones,
  zoneIndex,
  relevanceTags,
  filter,
  onChange,
}: {
  dialogues: readonly Dialogue[]
  zones: readonly Zone[]
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  relevanceTags: readonly RelevanceTag[]
  filter: DialogueFilter
  onChange: (filter: DialogueFilter) => void
}): ReactElement {
  const byZone = useMemo(
    () => zoneRows(dialogues, zones, zoneIndex, relevanceTags),
    [dialogues, zones, zoneIndex, relevanceTags],
  )
  const byNpc = useMemo(() => npcRows(dialogues, relevanceTags), [dialogues, relevanceTags])

  function select(target: RowTarget, segment: SegmentKey): void {
    const narrowed: DialogueFilter =
      target.kind === 'zones'
        ? { ...filter, zones: target.zones }
        : { ...filter, npcKeys: target.npcKeys }
    // "Untagged" isn't expressible as a relevance value (empty means "no opinion", not "no
    // tags"), so that segment narrows the row axis only and clears any tag filter.
    onChange({ ...narrowed, relevance: segment === 'untagged' ? [] : [segment] })
  }

  return (
    <section className="insights__panel card" aria-label="Relevance breakdown">
      <header className="insights__panel-head">
        <h2 className="insights__panel-title">Relevance</h2>
        <Disclosure>
          <p>
            A line counts once per tag it carries, so a doubly tagged line appears in both
            segments. Click a segment to filter.
          </p>
        </Disclosure>
      </header>

      <SegmentLegend tags={relevanceTags} />

      <div className="insights__charts">
        <BreakdownChart
          idPrefix="zone"
          title="By zone"
          noun="zones"
          rows={byZone}
          tags={relevanceTags}
          onSelect={select}
        />
        <BreakdownChart
          idPrefix="npc"
          title="By NPC"
          noun="NPCs"
          rows={byNpc}
          tags={relevanceTags}
          onSelect={select}
        />
      </div>
    </section>
  )
}

// viewBox units, and (per useChartWidth) one viewBox unit is one real CSS pixel.
const DEFAULT_WIDTH = 720
const LABEL_WIDTH = 168
const TOTAL_WIDTH = 44
const GAP = 10
const BAR_X = LABEL_WIDTH + GAP
const ROW_HEIGHT = 22
const ROW_PITCH = 30
const LABEL_MIN_SEGMENT = 24

function BreakdownChart({
  idPrefix,
  title,
  noun,
  rows,
  tags,
  onSelect,
}: {
  idPrefix: string
  title: string
  noun: string
  rows: readonly BreakdownRow[]
  tags: readonly RelevanceTag[]
  onSelect: (target: RowTarget, segment: SegmentKey) => void
}): ReactElement {
  const [svgRef, width] = useChartWidth<SVGSVGElement>(DEFAULT_WIDTH)
  const [expanded, setExpanded] = useState(false)
  const overflows = rows.length > ROW_LIMIT + 1
  const drawn = useMemo(
    () => (expanded || !overflows ? rows : foldOverflow(rows, tags, noun)),
    [expanded, overflows, rows, tags, noun],
  )
  const height = Math.max(drawn.length * ROW_PITCH, ROW_PITCH)
  const barWidth = Math.max(width - BAR_X - TOTAL_WIDTH - GAP, 0)
  // Scale is the largest row, never a fixed ceiling, so a single row still fills the bar.
  const widest = drawn.reduce((max, row) => Math.max(max, totalOf(row.counts)), 0)
  const keys = useMemo(() => segmentKeys(tags), [tags])
  const labels = useMemo(() => segmentLabel(tags), [tags])
  const colors = useMemo(() => segmentColor(tags), [tags])

  return (
    <figure className="insights__chart">
      <figcaption className="insights__chart-title micro-label">{title}</figcaption>
      {rows.length === 0 ? (
        <p className="insights__empty hint-text">No dialogues to break down.</p>
      ) : (
        <svg
          ref={svgRef}
          className="insights__svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={title}
        >
          <SegmentDefs idPrefix={idPrefix} tags={tags} />
          {drawn.map((row, index) => (
            <BreakdownBar
              key={row.key}
              idPrefix={idPrefix}
              row={row}
              keys={keys}
              labels={labels}
              colors={colors}
              y={index * ROW_PITCH}
              width={width}
              barWidth={barWidth}
              scale={widest === 0 ? 0 : barWidth / widest}
              onSelect={onSelect}
            />
          ))}
        </svg>
      )}
      {overflows && (
        <button
          type="button"
          className="insights__expand-rows disclosure-summary"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? `Fold back to the top ${ROW_LIMIT}` : `Show all ${rows.length} ${noun}`}
        </button>
      )}
    </figure>
  )
}

// The folded row stays clickable, so "Other" filters to exactly the rows it stands for.
function foldOverflow(
  rows: readonly BreakdownRow[],
  tags: readonly RelevanceTag[],
  noun: string,
): BreakdownRow[] {
  const tail = rows.slice(ROW_LIMIT)
  const merged = emptyTally(tags)
  for (const row of tail) {
    merged.dialogues += row.dialogues
    for (const [segment, count] of row.counts) {
      merged.counts.set(segment, (merged.counts.get(segment) ?? 0) + count)
    }
  }
  return [
    ...rows.slice(0, ROW_LIMIT),
    {
      key: 'overflow',
      label: `Other (${tail.length} ${noun})`,
      dialogues: merged.dialogues,
      counts: merged.counts,
      target: mergedTarget(tail),
    },
  ]
}

function mergedTarget(rows: readonly BreakdownRow[]): RowTarget {
  if (rows[0]?.target.kind === 'npcs') {
    return {
      kind: 'npcs',
      npcKeys: rows.flatMap((row) => (row.target.kind === 'npcs' ? row.target.npcKeys : [])),
    }
  }
  return {
    kind: 'zones',
    zones: rows.flatMap((row) => (row.target.kind === 'zones' ? row.target.zones : [])),
  }
}

function BreakdownBar({
  idPrefix,
  row,
  keys,
  labels,
  colors,
  y,
  width,
  barWidth,
  scale,
  onSelect,
}: {
  idPrefix: string
  row: BreakdownRow
  keys: readonly SegmentKey[]
  labels: ReadonlyMap<SegmentKey, string>
  colors: ReadonlyMap<SegmentKey, string>
  y: number
  width: number
  barWidth: number
  scale: number
  onSelect: (target: RowTarget, segment: SegmentKey) => void
}): ReactElement {
  const middle = y + ROW_HEIGHT / 2

  return (
    <g>
      <ClippedLabel text={row.label} maxWidth={LABEL_WIDTH} x={LABEL_WIDTH} y={middle} />
      <rect className="insights__track" x={BAR_X} y={y} width={barWidth} height={ROW_HEIGHT} rx="3" />
      {segmentRun(keys, row.counts, scale).map(({ segment, count, offset, extent }) => {
        const left = BAR_X + offset
        const label = `${row.label}, ${labels.get(segment) ?? ''}: ${count}`
        return (
          <g
            key={segment}
            className="insights__segment"
            role="button"
            tabIndex={0}
            onClick={() => onSelect(row.target, segment)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onSelect(row.target, segment)
            }}
          >
            <title>{label}</title>
            <SegmentFill
              idPrefix={idPrefix}
              segment={segment}
              color={colors.get(segment) ?? UNKNOWN_FILL}
              rect={{ x: left, y, width: extent, height: ROW_HEIGHT }}
            />
            {extent >= LABEL_MIN_SEGMENT && (
              <text
                className="insights__segment-count"
                x={left + extent / 2}
                y={middle}
                textAnchor="middle"
              >
                {count}
              </text>
            )}
          </g>
        )
      })}
      <text className="insights__row-total" x={width} y={middle} textAnchor="end">
        {row.dialogues}
      </text>
    </g>
  )
}

// Clips to maxWidth by measuring rendered glyphs (getComputedTextLength), not a character
// count — corrects in useLayoutEffect, before paint, so nothing overflowing is ever visible.
function ClippedLabel({
  text,
  maxWidth,
  x,
  y,
}: {
  text: string
  maxWidth: number
  x: number
  y: number
}): ReactElement {
  const ref = useRef<SVGTextElement>(null)
  const [display, setDisplay] = useState(text)

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null || text === '') {
      setDisplay(text)
      return
    }
    element.textContent = text
    if (element.getComputedTextLength() <= maxWidth) {
      setDisplay(text)
      return
    }
    let fits = 0
    let doesNotFit = text.length
    while (fits < doesNotFit) {
      const mid = Math.ceil((fits + doesNotFit) / 2)
      element.textContent = `${text.slice(0, mid)}…`
      if (element.getComputedTextLength() <= maxWidth) fits = mid
      else doesNotFit = mid - 1
    }
    setDisplay(fits === 0 ? '…' : `${text.slice(0, fits)}…`)
  }, [text, maxWidth])

  return (
    <text ref={ref} className="insights__row-label" x={x} y={y} textAnchor="end">
      {display}
    </text>
  )
}

function zoneRows(
  dialogues: readonly Dialogue[],
  zones: readonly Zone[],
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>,
  relevanceTags: readonly RelevanceTag[],
): BreakdownRow[] {
  const byZone = new Map<ZoneId, Tally>()
  const outside = emptyTally(relevanceTags)

  for (const dialogue of dialogues) {
    const inside = zoneIndex.get(dialogue.id) ?? []
    if (inside.length === 0) {
      tally(outside, dialogue)
      continue
    }
    // A line in two overlapping zones counts in both.
    for (const zoneId of inside) {
      const bucket = byZone.get(zoneId) ?? emptyTally(relevanceTags)
      tally(bucket, dialogue)
      byZone.set(zoneId, bucket)
    }
  }

  const rows: BreakdownRow[] = []
  for (const zone of zones) {
    const bucket = byZone.get(zone.id)
    if (bucket === undefined) continue
    rows.push({
      key: zone.id,
      label: zone.name.trim() === '' ? 'Unnamed zone' : zone.name,
      dialogues: bucket.dialogues,
      counts: bucket.counts,
      target: { kind: 'zones', zones: [zone.id] },
    })
  }
  if (outside.dialogues > 0) {
    rows.push({
      key: NO_ZONE,
      label: 'Outside any zone',
      dialogues: outside.dialogues,
      counts: outside.counts,
      target: { kind: 'zones', zones: [NO_ZONE] },
    })
  }
  return sortByDialogues(rows)
}

// Every NPC by line count; the chart folds the tail past ROW_LIMIT.
function npcRows(dialogues: readonly Dialogue[], relevanceTags: readonly RelevanceTag[]): BreakdownRow[] {
  const byNpc = new Map<string, Tally>()
  for (const dialogue of dialogues) {
    const key = npcKey(dialogue)
    const bucket = byNpc.get(key) ?? emptyTally(relevanceTags)
    tally(bucket, dialogue)
    byNpc.set(key, bucket)
  }

  return sortByDialogues(
    [...byNpc].map(([key, bucket]) => ({
      key: `npc:${key}`,
      label: npcLabel(key),
      dialogues: bucket.dialogues,
      counts: bucket.counts,
      target: { kind: 'npcs', npcKeys: [key] } as const,
    })),
  )
}

function sortByDialogues(rows: BreakdownRow[]): BreakdownRow[] {
  return rows.sort((a, b) => b.dialogues - a.dialogues || a.label.localeCompare(b.label))
}
