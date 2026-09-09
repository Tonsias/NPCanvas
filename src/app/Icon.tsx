import type { ReactElement } from 'react'

// Stroked, not filled like ContentGlyph: these render at 1rem inside a button, where a 1.3px
// stroke is legible, while a pin's glyph sits at ~14 device pixels and needs a solid mass.
// A record, not a lookup function, so a name that does not exist is a compile error at the
// call site — an icon-only button with no icon would be a button with nothing in it.
const ICON = {
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4.5" />
    </>
  ),
  redo: (
    <>
      <path d="M15 14l5-5-5-5" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h11.5" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
      <path d="M18.5 6l-.9 13a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6" />
    </>
  ),
  pencil: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  droplet: <path d="M12 2.7 17 7.7a7 7 0 1 1-9.9 0z" />,
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  'plus-circle': (
    <>
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </>
  ),
  'chevron-up': <path d="M18 15l-6-6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-left': <path d="M15 18l-6-6 6-6" />,
  'chevron-right': <path d="M9 18l6-6-6-6" />,
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7L11.7 5.3" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),
  unlink: (
    <>
      <path d="M18.84 12.25l1.72-1.71a4.24 4.24 0 0 0-6-6l-1.71 1.72" />
      <path d="M5.17 11.75l-1.71 1.71a4.24 4.24 0 0 0 6 6l1.71-1.71" />
      <path d="M8 2v3" />
      <path d="M2 8h3" />
      <path d="M16 22v-3" />
      <path d="M22 16h-3" />
    </>
  ),
  merge: (
    <>
      <path d="M21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0" />
      <path d="M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </>
  ),
  power: (
    <>
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <path d="M12 2v10" />
    </>
  ),
  crosshair: (
    <>
      <path d="M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0" />
      <path d="M22 12h-4" />
      <path d="M6 12H2" />
      <path d="M12 6V2" />
      <path d="M12 22v-4" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 21v-7" />
      <path d="M4 10V3" />
      <path d="M12 21v-9" />
      <path d="M12 8V3" />
      <path d="M20 21v-5" />
      <path d="M20 12V3" />
      <path d="M1 14h6" />
      <path d="M9 8h6" />
      <path d="M17 16h6" />
    </>
  ),
  search: (
    <>
      <path d="M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0" />
      <path d="M21 21l-4.35-4.35" />
    </>
  ),
  maximize: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
    </>
  ),
  record: <path fill="currentColor" stroke="none" d="M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />,
  stop: <path fill="currentColor" stroke="none" d="M6 6h12v12H6z" />,
  play: <path fill="currentColor" stroke="none" d="M7 4.5 19 12 7 19.5z" />,
  pause: <path fill="currentColor" stroke="none" d="M7 4.5h3.5v15H7z M13.5 4.5H17v15h-3.5z" />,
  'skip-back': (
    <>
      <path fill="currentColor" stroke="none" d="M19 4.5 8.5 12 19 19.5z" />
      <path d="M5 5v14" />
    </>
  ),
  'skip-forward': (
    <>
      <path fill="currentColor" stroke="none" d="M5 4.5 15.5 12 5 19.5z" />
      <path d="M19 5v14" />
    </>
  ),
  pointer: <path d="M4 3.5 19 11l-6.5 1.8L10.6 19z" />,
  'pin-plus': (
    <>
      <path d="M12 21s6-5.7 6-10a6 6 0 1 0-12 0c0 4.3 6 10 6 10" />
      <path d="M12 8v5" />
      <path d="M9.5 10.5h5" />
    </>
  ),
  polygon: <path d="M12 3 21 9.5 17.5 20h-11L3 9.5z" />,
  move: (
    <>
      <path d="M12 3v18" />
      <path d="M3 12h18" />
      <path d="M9 6l3-3 3 3" />
      <path d="M9 18l3 3 3-3" />
      <path d="M6 9l-3 3 3 3" />
      <path d="M18 9l3 3-3 3" />
    </>
  ),
  folder: <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4.5l2 3H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z" />,
}

export type IconName = keyof typeof ICON

/**
 * The picture on an icon-only button. Always decorative: the button it sits in carries the
 * accessible name (`aria-label`) and, wherever the verb is not obvious, a `title` — dropping the
 * visible word is only safe while both of those are there.
 */
export function Icon({ name }: { name: IconName }): ReactElement {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON[name]}
    </svg>
  )
}
