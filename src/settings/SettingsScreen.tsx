import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { useRef, useState } from 'react'
import { RovingRadioGroup } from '../app/RovingRadioGroup.tsx'
import { CaptureBar } from '../capture/CaptureBar.tsx'
import { RelevanceTagList } from '../insights/RelevanceTagList.tsx'
import type { ProjectFile } from '../project/types.ts'
import { PreferenceList } from './PreferenceList.tsx'
import { ShortcutList } from './ShortcutList.tsx'
import { getThemePreference, setThemePreference, THEME_PREFERENCES } from './theme.ts'
import './SettingsScreen.css'

/**
 * `key` doubles as the `PreferenceTab` for the four tabs that carry tuning rows; `project` and
 * `shortcuts` carry none, which is why this list is not `PREFERENCE_TABS`. `lede` is what the
 * tab owns, since a reader arriving at one has no other way to tell whether it holds something
 * the project keeps or something only this machine does.
 */
const SETTINGS_TABS = [
  { key: 'project', label: 'Project', lede: 'The vocabulary this project owns. Saved with the document.' },
  { key: 'canvas', label: 'Canvas', lede: 'How the map canvas reads and moves on this machine.' },
  { key: 'capture', label: 'Capture', lede: 'The rig that reads the console, and how patiently it watches.' },
  { key: 'cinema', label: 'Cinema', lede: 'How the reel paces a line and where it cuts a session.' },
  { key: 'interface', label: 'Interface', lede: 'Ground, lists and how much of each the app shows.' },
  { key: 'shortcuts', label: 'Shortcuts', lede: 'Every key the app binds.' },
] as const

type SettingsTab = (typeof SETTINGS_TABS)[number]['key']

/**
 * The fourth screen: project-wide setup rather than a place a dialogue is authored or read. See
 * CLAUDE.md § "What this app is" for why it does not compete with the other three for priority.
 * One tab per subject, since the screen now holds what the project owns *and* what only this
 * device does — two kinds a single scrolling column could not keep apart.
 */
export function SettingsScreen({ project }: { project: ProjectFile }): ReactElement {
  // Transient view state: which tab is open is not a fact about the project, and the route
  // deliberately carries no settings sub-path (CLAUDE.md § "Hash routing").
  const [tab, setTab] = useState<SettingsTab>('project')
  const active = SETTINGS_TABS.find((candidate) => candidate.key === tab) ?? SETTINGS_TABS[0]

  return (
    <section className="settings">
      <header className="settings__bar">
        <h1 className="screen-title">Settings</h1>
      </header>

      <SettingsTabs tab={tab} onChange={setTab} />

      <div className="settings__panel" role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
        <p className="settings__lede">{active.lede}</p>
        {tab === 'project' && (
          <RelevanceTagList relevanceTags={project.relevanceTags} dialogues={project.dialogues} />
        )}
        {tab === 'canvas' && (
          <section className="settings__section panel">
            <PreferenceList tab="canvas" />
          </section>
        )}
        {tab === 'capture' && (
          <>
            {/* Session-long setup, not a per-dialogue field — moved here from the dialogue panel
                (#91), which now carries only the button that acts on the selected line. */}
            <CaptureBar
              profiles={project.captureProfiles}
              glyphs={project.glyphs}
              bindings={project.recorderBindings}
            />
            <section className="settings__section panel">
              <PreferenceList tab="capture" />
            </section>
          </>
        )}
        {tab === 'cinema' && (
          <section className="settings__section panel">
            <PreferenceList tab="cinema" />
          </section>
        )}
        {tab === 'interface' && (
          <>
            <ThemePicker />
            <section className="settings__section panel">
              <PreferenceList tab="interface" />
            </section>
          </>
        )}
        {tab === 'shortcuts' && (
          <section className="settings__section panel">
            <ShortcutList />
          </section>
        )}
      </div>
    </section>
  )
}

/** Real tabs, not `RovingRadioGroup`: these swap a panel, and a screen reader is owed that. */
function SettingsTabs({ tab, onChange }: { tab: SettingsTab; onChange: (tab: SettingsTab) => void }): ReactElement {
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = SETTINGS_TABS[(index + step + SETTINGS_TABS.length) % SETTINGS_TABS.length]
    onChange(next.key)
    buttons.current[next.key]?.focus()
  }

  return (
    <div className="settings__tabs" role="tablist" aria-label="Settings sections">
      {SETTINGS_TABS.map((candidate, index) => (
        <button
          key={candidate.key}
          ref={(element) => {
            buttons.current[candidate.key] = element
          }}
          type="button"
          role="tab"
          id={`settings-tab-${candidate.key}`}
          className="settings__tab"
          aria-selected={candidate.key === tab}
          aria-controls={`settings-panel-${candidate.key}`}
          tabIndex={candidate.key === tab ? 0 : -1}
          onClick={() => onChange(candidate.key)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {candidate.label}
        </button>
      ))}
    </div>
  )
}

function ThemePicker(): ReactElement {
  const [preference, setPreference] = useState(getThemePreference)

  return (
    <section className="settings__section panel" aria-labelledby="settings-appearance-heading">
      <div className="settings__section-head">
        <h2 id="settings-appearance-heading" className="settings__section-title">
          Appearance
        </h2>
        <RovingRadioGroup
          className="settings__theme-picker"
          ariaLabel="Theme"
          orientation="horizontal"
          options={THEME_PREFERENCES}
          optionKey={(option) => option}
          selectedKey={preference}
          buttonClassName="settings__theme-button segmented-button"
          onChange={(option) => {
            setThemePreference(option)
            setPreference(option)
          }}
          renderOption={(option) => option}
        />
      </div>
    </section>
  )
}
