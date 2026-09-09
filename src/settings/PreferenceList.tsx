import type { ReactElement } from 'react'
import { useId } from 'react'
import { useFieldDraft } from '../use-field-draft.ts'
import type { PreferenceField, PreferenceTab } from './preferences.ts'
import { PREFERENCE_FIELDS, clampPreference, resetPreferences, setPreference, usePreferences } from './preferences.ts'

/**
 * The tuning rows for one tab. A number input rather than a slider: every one of these is a
 * quantity the player already knows in its own unit (a text speed in ms, a zoom in per cent),
 * and a slider would only make that quantity harder to state exactly.
 */
export function PreferenceList({ tab }: { tab: PreferenceTab }): ReactElement {
  const preferences = usePreferences()
  const fields = PREFERENCE_FIELDS.filter((field) => field.tab === tab)
  const modified = fields.some((field) => preferences[field.key] !== field.fallback)

  return (
    <div className="preference-list">
      {fields.map((field) => (
        <PreferenceRow key={field.key} field={field} value={preferences[field.key]} />
      ))}
      <button
        type="button"
        className="preference-list__reset button"
        disabled={!modified}
        onClick={() => resetPreferences(tab)}
      >
        Reset to defaults
      </button>
    </div>
  )
}

function PreferenceRow({ field, value }: { field: PreferenceField; value: number }): ReactElement {
  const inputId = useId()
  const hintId = `${inputId}-hint`
  // The same draft every other field in the app uses: half a typed number is not a preference,
  // and clamping each keystroke would fight anyone typing a value with more digits than the one
  // shown. An emptied field commits the default rather than 0, which `Number('')` would give.
  const draft = useFieldDraft(String(value), (text) =>
    setPreference(field.key, clampPreference(field, text.trim() === '' ? field.fallback : Number(text))),
  )

  return (
    <div className="preference-row">
      <label className="preference-row__label" htmlFor={inputId}>
        {field.label}
      </label>
      <div className="preference-row__control">
        <input
          id={inputId}
          className="preference-row__input text-input"
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          step={field.step}
          value={draft.value}
          aria-describedby={hintId}
          onChange={(event) => draft.onChange(event.target.value)}
          onBlur={draft.flush}
        />
        <span className="preference-row__unit">{field.unit}</span>
      </div>
      <p className="preference-row__hint" id={hintId}>
        {field.hint}
        {value !== field.fallback && <span className="preference-row__default"> Default {field.fallback}.</span>}
      </p>
    </div>
  )
}
