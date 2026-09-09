import { describe, expect, it } from 'vitest'
import { PREFERENCE_FIELDS, clampPreference } from './preferences.ts'

describe('preference fields', () => {
  it('declares a fallback inside its own range', () => {
    for (const field of PREFERENCE_FIELDS) {
      expect(field.min).toBeLessThan(field.max)
      expect(field.fallback).toBeGreaterThanOrEqual(field.min)
      expect(field.fallback).toBeLessThanOrEqual(field.max)
    }
  })

  it('names each key once', () => {
    const keys = PREFERENCE_FIELDS.map((field) => field.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('clampPreference', () => {
  const field = PREFERENCE_FIELDS[0]

  it('holds a value inside the range', () => {
    expect(clampPreference(field, field.min - 100)).toBe(field.min)
    expect(clampPreference(field, field.max + 100)).toBe(field.max)
  })

  // A field committed as letters or as nothing at all must land on the default, never on NaN —
  // a NaN in the store would reach `capture-watch`'s tick interval and the reel's dwell.
  it('falls back on a value that is not a number', () => {
    expect(clampPreference(field, Number.NaN)).toBe(field.fallback)
  })

  it('rounds, since every field is a whole quantity', () => {
    expect(clampPreference(field, field.min + 0.4)).toBe(field.min)
  })
})
