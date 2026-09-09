import { dialoguesByTimeAsc } from '../dialogue/dialogue-order.ts'
import { indexDialoguesByZone } from '../map/zone-index.ts'
import { getPreferences } from '../settings/preferences.ts'
import type { Preferences } from '../settings/preferences.ts'
import type { Dialogue, ProjectFile, ZoneId } from '../project/types.ts'

/** One line, placed on the reel's own ordinal axis — see CLAUDE.md § "Cinema". */
export type Moment = {
  dialogue: Dialogue
  /** Ordinal position, 0-based — the x axis every Cinema layer is drawn against. */
  index: number
  sessionIndex: number
  /** Real elapsed time since the previous moment; 0 for the first of the whole reel. */
  gapMsBefore: number
  /** Smallest containing zone, derived — never stored; see CLAUDE.md. */
  zoneId: ZoneId | null
  /** How long this line holds the stage at speed 1. */
  dwellMs: number
}

/** A run of moments with no gap between consecutive lines exceeding `sessionGapMinutes`. */
export type Session = {
  index: number
  firstMoment: Moment
  lastMoment: Moment
  /** The gap that opened this session; 0 for the reel's first session. */
  gapMsBefore: number
}

export type Reel = {
  moments: Moment[]
  sessions: Session[]
}

// The per-character term is the player's (`readingMsPerChar`); the floor and ceiling stay the
// app's, since they only keep the result inside what a stage can show.
const BASE_MS = 800
const MIN_DWELL_MS = 1500
const MAX_DWELL_MS = 12_000

// How long a single frame holds the stage during autoplay — flat, independent of how many
// frames a moment has, so a fifty-frame moment doesn't flip faster than a three-frame one.
export const MS_PER_FRAME = 300

function dwellFor(dialogue: Dialogue, msPerChar: number): number {
  const raw = BASE_MS + dialogue.text.length * msPerChar + dialogue.media.length * MS_PER_FRAME
  return Math.min(MAX_DWELL_MS, Math.max(MIN_DWELL_MS, raw))
}

function buildReelUncached(project: ProjectFile, preferences: Preferences): Reel {
  const sessionGapMs = preferences.sessionGapMinutes * 60_000
  const ordered = dialoguesByTimeAsc(project.dialogues)
  const zoneIndex = indexDialoguesByZone(project.dialogues, project.zones, project.maps)

  const moments: Moment[] = []
  const sessions: Session[] = []
  let previousAt: number | null = null

  for (const dialogue of ordered) {
    const at = Date.parse(dialogue.spokenAt)
    if (Number.isNaN(at)) continue

    const gapMsBefore = previousAt === null ? 0 : at - previousAt
    previousAt = at

    const startsSession = sessions.length === 0 || gapMsBefore > sessionGapMs
    const sessionIndex = startsSession ? sessions.length : sessions.length - 1

    const moment: Moment = {
      dialogue,
      index: moments.length,
      sessionIndex,
      gapMsBefore,
      zoneId: (zoneIndex.get(dialogue.id) ?? [])[0] ?? null,
      dwellMs: dwellFor(dialogue, preferences.readingMsPerChar),
    }
    moments.push(moment)

    if (startsSession) {
      sessions.push({ index: sessionIndex, firstMoment: moment, lastMoment: moment, gapMsBefore })
    } else {
      sessions[sessionIndex] = { ...sessions[sessionIndex], lastMoment: moment }
    }
  }

  return { moments, sessions }
}

// Not `identityCache`: the reel is pure over the document *and* the player's pacing, two inputs.
let cached: { project: ProjectFile; preferences: Preferences; reel: Reel } | null = null

/** Pure over the document and the reading preferences — see CLAUDE.md § "Store scope". */
export function buildReel(project: ProjectFile): Reel {
  const preferences = getPreferences()
  if (cached !== null && cached.project === project && cached.preferences === preferences) {
    return cached.reel
  }
  const reel = buildReelUncached(project, preferences)
  cached = { project, preferences, reel }
  return reel
}
