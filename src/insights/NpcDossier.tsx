import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Disclosure } from '../app/Disclosure.tsx'
import { RowActions } from '../app/RowActions.tsx'
import { formatSpokenAt, resolveZones, zoneLabel } from '../dialogue-row/dialogue-summary.ts'
import { zoneHueStyle } from '../map/zone-style.ts'
import { indexQuestsByDialogue } from '../quest/quest-index.ts'
import { questAccentStyle } from '../quest/quest-style.ts'
import { dispatch } from '../project/store.ts'
import { subsetByTimeAsc } from '../dialogue/dialogue-order.ts'
import type {
  Dialogue,
  DialogueId,
  Quest,
  RelevanceTag,
  Zone,
  ZoneId,
} from '../project/types.ts'
import { FoldRows, ROW_LIMIT } from './FoldRows.tsx'
import { NpcLines } from './NpcLines.tsx'
import { SegmentDefs, SegmentFill, SegmentLegend, UNKNOWN_FILL } from './SegmentLegend.tsx'
import type { DossierFilter } from './dossier-filter.ts'
import {
  EMPTY_DOSSIER_FILTER,
  applyDossierFilter,
  isEmptyDossierFilter,
  pruneDossierFilter,
} from './dossier-filter.ts'
import { npcKey, npcLabel, toggleFilterValue } from './filters.ts'
import type { SegmentKey, Tally } from './relevance-segments.ts'
import {
  emptyTally,
  segmentColor,
  segmentKeys,
  segmentLabel,
  segmentRun,
  tally,
  totalOf,
} from './relevance-segments.ts'
import { Icon } from '../app/Icon.tsx'

// Derived on every read — nothing here is stored.
type NpcProfile = {
  key: string
  label: string
  dialogues: Dialogue[]
  tally: Tally
  zones: Zone[]
  quests: Quest[]
}

// Reads the filtered dialogues like every other panel, so a dossier opened under a filter is
// honestly "what this NPC said, within what you're looking at", not a quietly different set.
export function NpcDossier({
  dialogues,
  quests,
  zonesById,
  zoneIndex,
  relevanceTags,
  selectedKey,
  filter,
  onChange,
}: {
  dialogues: readonly Dialogue[]
  quests: readonly Quest[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  relevanceTags: readonly RelevanceTag[]
  selectedKey: string | null
  filter: DossierFilter
  onChange: (next: { key: string | null; filter: DossierFilter }) => void
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const questsByDialogue = useMemo(() => indexQuestsByDialogue(quests), [quests])
  const profiles = useMemo(
    () => buildProfiles(dialogues, questsByDialogue, zonesById, zoneIndex, relevanceTags),
    [dialogues, questsByDialogue, zonesById, zoneIndex, relevanceTags],
  )

  // A key the filter or a rename has since removed falls back to the top of the list.
  const selected = profiles.find((profile) => profile.key === selectedKey) ?? profiles[0] ?? null
  // Pruned here too, not only in the click handler below: the global filter can retire the
  // selected NPC without anyone clicking, and the chips must never disagree with what is applied.
  const offered = selected === null ? EMPTY_DOSSIER_FILTER : offeredBy(selected, relevanceTags)
  const effective = pruneDossierFilter(filter, offered)
  // Folded like the breakdown charts, except that the open NPC is always drawn: the tail here is
  // a list of selections, not a bar it could be folded into, and the list has to say which one
  // the dossier beside it belongs to.
  const overflows = profiles.length > ROW_LIMIT + 1
  const listed =
    expanded || !overflows ? profiles : withSelected(profiles.slice(0, ROW_LIMIT), selected)

  return (
    <section className="insights__panel panel" aria-label="NPC dossier">
      <header className="insights__panel-head">
        <h2 className="insights__panel-title">Who said it</h2>
        <p className="insights__panel-note hint-text">NPCs by line count.</p>
        <Disclosure>
          <p>
            Renaming one here renames every line they said — and merges them into an NPC of that
            name if one already exists.
          </p>
        </Disclosure>
      </header>

      <SegmentLegend tags={relevanceTags} />

      {profiles.length === 0 ? (
        <p className="insights__empty hint-text">Nobody has said anything in this selection.</p>
      ) : (
        <div className="npc-dossier">
          <svg className="npc-dossier__defs" aria-hidden="true">
            <SegmentDefs idPrefix="npc" tags={relevanceTags} />
          </svg>

          <div className="npc-dossier__index">
            <ul className="npc-dossier__list">
              {listed.map((profile) => (
                <li key={profile.key}>
                  <button
                    type="button"
                    className="npc-dossier__entry"
                    aria-pressed={profile === selected}
                    onClick={() =>
                      onChange({
                        key: profile.key,
                        filter: pruneDossierFilter(filter, offeredBy(profile, relevanceTags)),
                      })
                    }
                  >
                    <span className="npc-dossier__name">{profile.label}</span>
                    <span className="npc-dossier__count hint-text">{profile.dialogues.length}</span>
                    <SegmentBar
                      counts={profile.tally.counts}
                      tags={relevanceTags}
                      className="npc-dossier__spark"
                    />
                  </button>
                </li>
              ))}
            </ul>
            {overflows && (
              <FoldRows
                expanded={expanded}
                total={profiles.length}
                noun="NPCs"
                onToggle={() => setExpanded((open) => !open)}
              />
            )}
          </div>

          {selected !== null && (
            <Dossier
              // Remounts on selection, resetting the rename draft and the line carousel.
              key={selected.key}
              profile={selected}
              knownKeys={profiles.map((profile) => profile.key)}
              zonesById={zonesById}
              zoneIndex={zoneIndex}
              questsByDialogue={questsByDialogue}
              relevanceTags={relevanceTags}
              offered={offered}
              filter={effective}
              onFilterChange={(filter) => onChange({ key: selected.key, filter })}
              onRenamed={(key) => onChange({ key, filter: effective })}
            />
          )}
        </div>
      )}
    </section>
  )
}

function Dossier({
  profile,
  knownKeys,
  zonesById,
  zoneIndex,
  questsByDialogue,
  relevanceTags,
  offered,
  filter,
  onFilterChange,
  onRenamed,
}: {
  profile: NpcProfile
  knownKeys: readonly string[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  questsByDialogue: ReadonlyMap<DialogueId, Quest[]>
  relevanceTags: readonly RelevanceTag[]
  offered: DossierFilter
  filter: DossierFilter
  onFilterChange: (filter: DossierFilter) => void
  onRenamed: (key: string) => void
}): ReactElement {
  const first = profile.dialogues[0]
  const last = profile.dialogues[profile.dialogues.length - 1]
  const labels = segmentLabel(relevanceTags)
  const colors = segmentColor(relevanceTags)
  // The three chip runs narrow only the carousel below them; the facts and the profile bar stay
  // the whole NPC, so the chips read as "of these lines, show me…" rather than as a second scope.
  const lines = useMemo(
    () => applyDossierFilter(profile.dialogues, filter, zoneIndex, questsByDialogue),
    [profile.dialogues, filter, zoneIndex, questsByDialogue],
  )

  return (
    <article className="npc-dossier__detail">
      <RenameForm profile={profile} knownKeys={knownKeys} onRenamed={onRenamed} />

      <dl className="npc-dossier__facts">
        <Fact term="Lines">{profile.dialogues.length}</Fact>
        <Fact term="First seen">{first === undefined ? '—' : formatSpokenAt(first.spokenAt)}</Fact>
        <Fact term="Last seen">{last === undefined ? '—' : formatSpokenAt(last.spokenAt)}</Fact>
      </dl>

      <section className="npc-dossier__section" aria-label="Relevance profile">
        <h4 className="micro-label">Relevance</h4>
        <SegmentBar
          counts={profile.tally.counts}
          tags={relevanceTags}
          className="npc-dossier__profile"
        />
        <ChipRow
          items={offered.relevance}
          valueOf={(segment) => segment}
          selected={filter.relevance}
          onChange={(relevance) => onFilterChange({ ...filter, relevance })}
          chip={(segment) => ({
            label: (
              <>
                <span
                  className="dot-swatch"
                  style={{ background: colors.get(segment) ?? 'transparent' }}
                  aria-hidden="true"
                />
                {labels.get(segment) ?? ''} {profile.tally.counts.get(segment) ?? 0}
              </>
            ),
          })}
        />
      </section>

      <section className="npc-dossier__section" aria-label="Zones encountered in">
        <h4 className="micro-label">Encountered in</h4>
        {profile.zones.length === 0 ? (
          <p className="insights__empty hint-text">Never inside a zone.</p>
        ) : (
          <ChipRow
            items={profile.zones}
            valueOf={(zone) => zone.id}
            selected={filter.zones}
            onChange={(zones) => onFilterChange({ ...filter, zones })}
            chip={(zone) => ({ style: zoneHueStyle(zone.hue), label: zoneLabel(zone) })}
          />
        )}
      </section>

      <section className="npc-dossier__section" aria-label="Quests">
        <h4 className="micro-label">Quests</h4>
        {profile.quests.length === 0 ? (
          <p className="insights__empty hint-text">None of their lines belong to a quest yet.</p>
        ) : (
          <ChipRow
            items={profile.quests}
            valueOf={(quest) => quest.id}
            selected={filter.quests}
            onChange={(quests) => onFilterChange({ ...filter, quests })}
            chip={(quest) => ({
              style: questAccentStyle(quest),
              label: quest.name.trim() === '' ? 'Untitled quest' : quest.name,
            })}
          />
        )}
      </section>

      <section className="npc-dossier__section" aria-label="Lines">
        <div className="npc-dossier__lines-head">
          <h4 className="micro-label">
            {isEmptyDossierFilter(filter) ? 'Lines' : `Lines — ${lines.length} of ${profile.dialogues.length}`}
          </h4>
          {!isEmptyDossierFilter(filter) && (
            <button
              type="button"
              className="button"
              onClick={() => onFilterChange(EMPTY_DOSSIER_FILTER)}
            >
              Clear chips
            </button>
          )}
        </div>
        <NpcLines
          dialogues={lines}
          label={profile.label}
          zonesById={zonesById}
          zoneIndex={zoneIndex}
        />
      </section>
    </article>
  )
}

// One run of toggle chips over one field of the dossier filter — three sections, one shape:
// what the NPC offers, which of it is on, and how a value draws itself. `style` publishes the
// hue custom property `.hue-chip`'s own recipe (index.css) selects on, so a value without a hue
// simply passes none.
function ChipRow<T, V>({
  items,
  valueOf,
  selected,
  onChange,
  chip,
}: {
  items: readonly T[]
  valueOf: (item: T) => V
  selected: readonly V[]
  onChange: (selected: V[]) => void
  chip: (item: T) => { style?: CSSProperties; label: ReactNode }
}): ReactElement {
  return (
    <ul className="npc-dossier__chips">
      {items.map((item) => {
        const value = valueOf(item)
        const { style, label } = chip(item)
        return (
          <li key={String(value)}>
            <button
              type="button"
              className={style === undefined ? 'npc-dossier__chip' : 'npc-dossier__chip hue-chip'}
              style={style}
              aria-pressed={selected.includes(value)}
              onClick={() => onChange(toggleFilterValue(selected, value))}
            >
              {label}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// Collapsed until invoked, since renaming rewrites every line the NPC ever said.
function RenameForm({
  profile,
  knownKeys,
  onRenamed,
}: {
  profile: NpcProfile
  knownKeys: readonly string[]
  onRenamed: (key: string) => void
}): ReactElement {
  const [renaming, setRenaming] = useState(false)

  if (!renaming) {
    return (
      <div className="npc-dossier__rename row-actions-host">
        <h3 className="npc-dossier__title">{profile.label}</h3>
        <RowActions>
          <button
            type="button"
            className="button"
            aria-label={`Rename ${profile.label}`}
            title="Rename"
            onClick={() => setRenaming(true)}
          >
            <Icon name="pencil" />
          </button>
        </RowActions>
      </div>
    )
  }

  return (
    <RenameFields
      profile={profile}
      knownKeys={knownKeys}
      onDone={(key) => {
        setRenaming(false)
        if (key !== null) onRenamed(key)
      }}
    />
  )
}

// An explicit submit, deliberately not the per-keystroke dispatch QuestForm/DialogueForm use —
// this rewrites every line the NPC said, and typing "T" toward "Tomas" would merge into an
// existing "T" before the second keystroke landed.
function RenameFields({
  profile,
  knownKeys,
  onDone,
}: {
  profile: NpcProfile
  knownKeys: readonly string[]
  onDone: (key: string | null) => void
}): ReactElement {
  const [draft, setDraft] = useState(profile.key)
  const next = draft.trim()
  const merges = next !== profile.key && knownKeys.includes(next)

  return (
    <form
      className="npc-dossier__rename"
      onSubmit={(event) => {
        event.preventDefault()
        if (next === profile.key) return
        dispatch({ kind: 'npc/renamed', from: profile.key, to: next })
        onDone(next)
      }}
    >
      <h3 className="npc-dossier__title">{profile.label}</h3>
      <input
        className="text-input npc-dossier__input"
        value={draft}
        autoFocus
        aria-label={`Rename ${profile.label}`}
        placeholder={profile.key === '' ? 'Give them a name' : 'New name'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone(null)
        }}
      />
      <button type="submit" className="button" disabled={next === profile.key}>
        {next === '' ? 'Clear name' : 'Rename'}
      </button>
      <button
        type="button"
        className="button"
        aria-label="Cancel"
        title="Cancel"
        onClick={() => onDone(null)}
      >
        <Icon name="close" />
      </button>
      {merges && (
        <p className="npc-dossier__merge" role="status">
          Merges with the lines already under {npcLabel(next)}.
        </p>
      )}
    </form>
  )
}

function Fact({
  term,
  children,
}: {
  term: string
  children: string | number
}): ReactElement {
  return (
    <div className="npc-dossier__fact">
      <dt className="micro-label">{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function SegmentBar({
  counts,
  tags,
  className,
}: {
  counts: Map<SegmentKey, number>
  tags: readonly RelevanceTag[]
  className: string
}): ReactElement {
  const total = totalOf(counts)
  const colors = segmentColor(tags)

  return (
    <svg className={className} viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
      {total === 0 ? (
        <rect width="100" height="8" className="insights__track" />
      ) : (
        segmentRun(segmentKeys(tags), counts, 100 / total).map(({ segment, offset, extent }) => (
          <SegmentFill
            key={segment}
            idPrefix="npc"
            segment={segment}
            color={colors.get(segment) ?? UNKNOWN_FILL}
            rect={{ x: offset, y: 0, width: extent, height: 8 }}
          />
        ))
      )}
    </svg>
  )
}

// The open NPC joins the folded head rather than vanishing with the tail — it may sit anywhere
// in the order, and the list is how a reader sees which dossier is showing.
function withSelected(head: NpcProfile[], selected: NpcProfile | null): NpcProfile[] {
  if (selected === null || head.includes(selected)) return head
  return [...head, selected]
}

// What this NPC can answer — the chips drawn below, and the set a filter carried over from the
// previous NPC is narrowed to.
function offeredBy(profile: NpcProfile, relevanceTags: readonly RelevanceTag[]): DossierFilter {
  return {
    relevance: segmentKeys(relevanceTags).filter(
      (segment) => (profile.tally.counts.get(segment) ?? 0) > 0,
    ),
    zones: profile.zones.map((zone) => zone.id),
    quests: profile.quests.map((quest) => quest.id),
  }
}

// Blank names are a group of their own, not dropped — renamable like any other.
function buildProfiles(
  dialogues: readonly Dialogue[],
  questsByDialogue: ReadonlyMap<DialogueId, Quest[]>,
  zonesById: ReadonlyMap<ZoneId, Zone>,
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>,
  relevanceTags: readonly RelevanceTag[],
): NpcProfile[] {
  const byKey = new Map<string, Dialogue[]>()
  for (const dialogue of dialogues) {
    const key = npcKey(dialogue)
    const bucket = byKey.get(key)
    if (bucket === undefined) byKey.set(key, [dialogue])
    else bucket.push(dialogue)
  }

  const profiles = [...byKey].map(([key, lines]) => {
    const ordered = subsetByTimeAsc(lines, dialogues)
    const counts = emptyTally(relevanceTags)
    const zones = new Map<ZoneId, Zone>()
    const questSet = new Map<Quest['id'], Quest>()
    for (const dialogue of ordered) {
      tally(counts, dialogue)
      for (const zone of resolveZones(dialogue.id, zoneIndex, zonesById)) zones.set(zone.id, zone)
      for (const quest of questsByDialogue.get(dialogue.id) ?? []) questSet.set(quest.id, quest)
    }
    return {
      key,
      label: npcLabel(key),
      dialogues: ordered,
      tally: counts,
      zones: [...zones.values()],
      quests: [...questSet.values()],
    }
  })

  return profiles.sort(
    (a, b) =>
      b.dialogues.length - a.dialogues.length ||
      // The unnamed group sorts last among equals.
      Number(a.key === '') - Number(b.key === '') ||
      a.label.localeCompare(b.label),
  )
}