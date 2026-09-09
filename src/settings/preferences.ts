import { useSyncExternalStore } from 'react'

/**
 * Numbers the app used to spell inline that a player's own game, screen or reading pace makes
 * wrong — the text speed a console prints at, how far out pin labels stay readable, how long a
 * break has to be before it reads as a new sitting. Device-scoped like `theme.ts`, not part of
 * `data.json`: they say how this machine is played on, not what was played, so they cost no
 * schema version and never travel with a project a second reader opens.
 */
export type Preferences = {
  pinLabelZoomPercent: number
  zoomStepPercent: number
  captureSettleMs: number
  heldFrameLimit: number
  sessionGapMinutes: number
  readingMsPerChar: number
  searchResultLimit: number
  recentNpcLimit: number
}

type PreferenceKey = keyof Preferences

/** Which tab a field sits under; the same order the tabs are shown in. */
export const PREFERENCE_TABS = ['canvas', 'capture', 'cinema', 'interface'] as const
export type PreferenceTab = (typeof PREFERENCE_TABS)[number]

/**
 * One row of the table the settings UI renders and `readStored` validates against — a field is
 * declared once, not once per screen. `hint` says what the number costs in both directions,
 * since none of these has a right answer the app could pick for the player.
 */
export type PreferenceField = {
  key: PreferenceKey
  tab: PreferenceTab
  label: string
  unit: string
  hint: string
  min: number
  max: number
  step: number
  fallback: number
}

export const PREFERENCE_FIELDS: readonly PreferenceField[] = [
  {
    key: 'pinLabelZoomPercent',
    tab: 'canvas',
    label: 'Pin labels appear at',
    unit: '%',
    hint: 'Below this zoom a pin shows no name. Lower it on a large screen, raise it where labels overlap.',
    min: 10,
    max: 200,
    step: 5,
    fallback: 50,
  },
  {
    key: 'zoomStepPercent',
    tab: 'canvas',
    label: 'Zoom step',
    unit: '%',
    hint: 'How far one press of + or −, or one zoom button, moves the canvas.',
    min: 105,
    max: 200,
    step: 5,
    fallback: 125,
  },
  {
    key: 'captureSettleMs',
    tab: 'capture',
    label: 'Text settle window',
    unit: 'ms',
    hint: 'How long the box must read the same before the watcher calls it finished. Raise it for a slow text speed, which would otherwise settle mid-sentence.',
    min: 50,
    max: 600,
    step: 50,
    fallback: 150,
  },
  {
    key: 'heldFrameLimit',
    tab: 'capture',
    label: 'Frames held for placing',
    unit: 'frames',
    hint: 'How many unplaced captures are kept before the oldest is dropped.',
    min: 4,
    max: 96,
    step: 4,
    fallback: 24,
  },
  {
    key: 'sessionGapMinutes',
    tab: 'cinema',
    label: 'New session after',
    unit: 'min',
    hint: 'A gap this long reads as the controller being put down, and starts a new session on the reel.',
    min: 5,
    max: 240,
    step: 5,
    fallback: 30,
  },
  {
    key: 'readingMsPerChar',
    tab: 'cinema',
    label: 'Reading pace',
    unit: 'ms per character',
    hint: 'How long a line holds the stage at speed 1, per character of text.',
    min: 10,
    max: 120,
    step: 5,
    fallback: 40,
  },
  {
    key: 'searchResultLimit',
    tab: 'interface',
    label: 'Search results shown',
    unit: 'results',
    hint: 'Past this many the palette stops being scannable at a glance; the rest are counted, not listed.',
    min: 10,
    max: 100,
    step: 5,
    fallback: 30,
  },
  {
    key: 'recentNpcLimit',
    tab: 'interface',
    label: 'Recent NPCs listed first',
    unit: 'names',
    hint: 'How many recently spoken names lead the NPC list before it turns alphabetical.',
    min: 0,
    max: 20,
    step: 1,
    fallback: 5,
  },
]

const STORAGE_KEY = 'npcanvas.preferences'

export function clampPreference(field: PreferenceField, value: number): number {
  if (!Number.isFinite(value)) return field.fallback
  return Math.min(field.max, Math.max(field.min, Math.round(value)))
}

function readStored(): Preferences {
  let raw: unknown = null
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) raw = JSON.parse(stored)
  } catch { /* Site data blocked or the entry is not JSON — every field falls back. */ }
  const stored = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const preferences = {} as Preferences
  for (const field of PREFERENCE_FIELDS) {
    const value = stored[field.key]
    preferences[field.key] = typeof value === 'number' ? clampPreference(field, value) : field.fallback
  }
  return preferences
}

// Replaced wholesale on every write, never mutated: `usePreferences` and `buildReel`'s cache both
// compare it by identity, so an in-place edit would go unnoticed by both.
let current: Preferences = readStored()
const listeners = new Set<() => void>()

/** For the modules that read a preference outside React — the watcher, the reel, the search index. */
export function getPreferences(): Preferences {
  return current
}

export function setPreference(key: PreferenceKey, value: number): void {
  const field = PREFERENCE_FIELDS.find((candidate) => candidate.key === key)
  if (field === undefined) return
  current = { ...current, [key]: clampPreference(field, value) }
  persist()
}

export function resetPreferences(tab: PreferenceTab): void {
  const next = { ...current }
  for (const field of PREFERENCE_FIELDS) {
    if (field.tab === tab) next[field.key] = field.fallback
  }
  current = next
  persist()
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch { /* Site data blocked — the choice still applies for this session. */ }
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getPreferences)
}

/** A number is its own stable snapshot, so a component that needs one field subscribes to one. */
export function usePreference(key: PreferenceKey): number {
  return useSyncExternalStore(subscribe, () => current[key])
}
