export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const
type ThemePreference = (typeof THEME_PREFERENCES)[number]

// Repeated verbatim by the pre-paint resolver in index.html, which cannot import this module.
const STORAGE_KEY = 'npcanvas.theme'
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

/**
 * Device-scoped, not project-scoped: which ground a reader wants is a property of the machine
 * they are reading on, so it lives in localStorage rather than in `data.json` or the store.
 */
export function getThemePreference(): ThemePreference {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch { /* Site data blocked — the system preference is still a working answer. */ }
  return THEME_PREFERENCES.find((preference) => preference === stored) ?? 'system'
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch { /* Site data blocked — the choice still applies for this session. */ }
  applyTheme(preference)
}

function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme =
    preference === 'system' ? (systemDark.matches ? 'dark' : 'light') : preference
}

/** Without this, 'system' would only be read once, at the pre-paint resolve. */
export function startThemeWatch(): void {
  systemDark.addEventListener('change', () => {
    if (getThemePreference() === 'system') applyTheme('system')
  })
}
