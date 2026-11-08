// The labelled corpus: reads eval/corpus/<id>.json files, checks every label
// and turns version 1 and version 2 files into one shape. A label that
// can't be scored is an error, so a run never measures against garbage,
// including a scan time whose offset isn't the spot's zone at that moment.
// See eval/README.md for the format and the labelling rubric.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import tzlookup from 'tz-lookup'

export const SPLITS = ['dev', 'test']
/** A leave-by time or a duration within this many minutes of the label counts as right. */
export const TOLERANCE_MINUTES = 1
/** The zone the sign reader assumes without coordinates (lambda/index.js DEFAULT_TIMEZONE). */
export const DEFAULT_TIMEZONE = 'Australia/Melbourne'
export const SIGN_STATUSES = ['readable', 'partially_obscured', 'missing', 'contradictory', 'not_a_parking_sign']
/** Sign details a label can state. Booleans unless named below. */
export const FLAG_KEYS = [
  'requires_ticket',
  'payment_methods',
  'requires_disabled_permit',
  'is_permit_zone',
  'permit_area',
  'is_area_sign',
]
const BOOLEAN_FLAGS = new Set(['requires_ticket', 'requires_disabled_permit', 'is_permit_zone', 'is_area_sign'])

const TOP_LEVEL_KEYS = new Set([
  'format',
  'id',
  'image',
  'split',
  'tags',
  'scanContext',
  'expected',
  'expected_variant',
  'expected_sign_status',
  'expected_flags',
])
const EXPECTED_KEYS = new Set(['can_park_now', 'until', 'duration_minutes', 'note'])

/** An ISO 8601 time with seconds optional and a Z or numeric offset. */
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

export function isIsoWithOffset(value) {
  return typeof value === 'string' && ISO_WITH_OFFSET_RE.test(value) && Number.isFinite(Date.parse(value))
}

/**
 * The zone the sign reader uses for a scan at lat/lng, resolved the way
 * lambda/index.js resolveTimezone does: tz-lookup, and Melbourne when the
 * coordinates are missing or can't be looked up.
 */
export function zoneForCoords(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return DEFAULT_TIMEZONE
  try {
    return tzlookup(lat, lng) || DEFAULT_TIMEZONE
  } catch {
    return DEFAULT_TIMEZONE
  }
}

/** The zone's UTC offset in minutes at the instant `ms`. */
export function zoneOffsetMinutes(ms, timeZone) {
  const seconds = Math.floor(ms / 1000) * 1000
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(seconds))
  const get = (type) => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((wall - seconds) / 60_000)
}

/** The offset written on an ISO time, in minutes ("Z" is 0). */
function writtenOffsetMinutes(iso) {
  const m = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(iso)
  if (!m || m[1] === 'Z') return 0
  return (m[2] === '-' ? -1 : 1) * (Number(m[3]) * 60 + Number(m[4]))
}

export function formatOffset(minutes) {
  const abs = Math.abs(minutes)
  return `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/**
 * Checks that a scan time is written the way the app sends one: the local
 * time on the clock at the spot, with that zone's own offset at that moment.
 * The sign reader passes the time to the model word for word as the local
 * time, so a daylight saving slip (+10:00 for +11:00) or a UTC time asks the
 * model a different question from the one the label answers. Returns an
 * error message, or null when the time is right.
 */
export function scanTimeError(datetime, timeZone) {
  const written = writtenOffsetMinutes(datetime)
  const actual = zoneOffsetMinutes(Date.parse(datetime), timeZone)
  if (written === actual) return null
  const wallClock = datetime.replace(/(Z|[+-]\d{2}:\d{2})$/, '')
  const suggestion = `${wallClock}${formatOffset(actual)}`
  if (zoneOffsetMinutes(Date.parse(suggestion), timeZone) !== actual) {
    return `scanContext.datetime ${datetime}: ${wallClock.replace('T', ' ')} never shows on the clock in ${timeZone} (the clocks skip it when daylight saving starts). Pick another time.`
  }
  return `scanContext.datetime ${datetime}: the offset ${datetime.endsWith('Z') ? 'Z' : formatOffset(written)} isn't ${timeZone}'s offset at that moment (${formatOffset(actual)}). Write the time on the clock there with its own offset, for example ${suggestion}.`
}

const MEDIA_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

export function mediaTypeFor(name) {
  const lower = String(name).toLowerCase()
  const ext = Object.keys(MEDIA_TYPES).find((e) => lower.endsWith(e))
  return ext ? MEDIA_TYPES[ext] : null
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Checks one parsed label file. Returns `{ entry, errors, warnings }`;
 * `entry` is null when there are errors. `file` is the JSON file name,
 * used for the default id and in messages.
 */
export function normalizeEntry(raw, file) {
  const errors = []
  const warnings = []
  const where = file
  if (!isObject(raw)) {
    return { entry: null, errors: [`${where}: the file must hold one JSON object`], warnings }
  }
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) warnings.push(`${where}: unknown key "${key}" is ignored`)
  }

  const format = raw.format === undefined ? 1 : raw.format
  if (format !== 1 && format !== 2) errors.push(`${where}: format must be 1 or 2`)

  const fallbackId = String(file).replace(/\.json$/i, '')
  const id = raw.id === undefined ? fallbackId : raw.id
  if (typeof id !== 'string' || !id.trim()) errors.push(`${where}: id must be a non-empty string`)

  if (typeof raw.image !== 'string' || !raw.image.trim()) {
    errors.push(`${where}: image must name the photo file next to this label`)
  } else if (!mediaTypeFor(raw.image)) {
    errors.push(`${where}: image must be a .jpg, .jpeg, .png or .webp file`)
  }

  let split = raw.split
  if (split === undefined) {
    split = 'dev'
    warnings.push(`${where}: no split, counted as dev (a photo without a split is never a test photo)`)
  } else if (!SPLITS.includes(split)) {
    errors.push(`${where}: split must be "dev" or "test"`)
  }

  const tags = raw.tags === undefined ? [] : raw.tags
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string' && t.trim())) {
    errors.push(`${where}: tags must be an array of non-empty strings`)
  }

  const ctx = raw.scanContext
  let timezone = DEFAULT_TIMEZONE
  let scanMs = null
  if (!isObject(ctx)) {
    errors.push(`${where}: scanContext is required, with lat, lng and datetime`)
  } else {
    for (const axis of ['lat', 'lng']) {
      if (ctx[axis] !== undefined && !Number.isFinite(ctx[axis])) errors.push(`${where}: scanContext.${axis} must be a number`)
    }
    if (ctx.lat === undefined || ctx.lng === undefined) {
      warnings.push(`${where}: no scanContext lat and lng, so the reader assumes Melbourne time`)
    }
    timezone = zoneForCoords(ctx.lat, ctx.lng)
    if (!isIsoWithOffset(ctx.datetime)) {
      errors.push(
        `${where}: scanContext.datetime must be an ISO time with an offset, such as 2026-05-20T14:30:00+10:00. Without it the answer depends on when the eval runs.`,
      )
    } else {
      const zoneError = scanTimeError(ctx.datetime, timezone)
      if (zoneError) errors.push(`${where}: ${zoneError}`)
      else scanMs = Date.parse(ctx.datetime)
    }
  }

  const exp = raw.expected
  if (!isObject(exp)) {
    errors.push(`${where}: expected is required, with can_park_now at least`)
  } else {
    for (const key of Object.keys(exp)) {
      if (!EXPECTED_KEYS.has(key)) warnings.push(`${where}: unknown key "expected.${key}" is ignored`)
    }
    if (typeof exp.can_park_now !== 'boolean') errors.push(`${where}: expected.can_park_now must be true or false`)
    // Version 2 labels state both answers, null included, so a missing key
    // can't quietly turn the leave-by check off. Version 1 labels are lenient.
    if (format === 2) {
      for (const key of ['until', 'duration_minutes']) {
        if (exp[key] === undefined) {
          errors.push(`${where}: expected.${key} is required in a format 2 label (null when there's none)`)
        }
      }
    }
    if (exp.until !== undefined && exp.until !== null && !isIsoWithOffset(exp.until)) {
      errors.push(`${where}: expected.until must be null or an ISO time with an offset`)
    }
    if (exp.can_park_now === false && typeof exp.until === 'string') {
      errors.push(`${where}: expected.until must be null when you can't park now`)
    }
    let durationOk = false
    if (exp.duration_minutes !== undefined && exp.duration_minutes !== null) {
      if (!Number.isFinite(exp.duration_minutes) || exp.duration_minutes < 0) {
        errors.push(`${where}: expected.duration_minutes must be null or a number of minutes, 0 or more`)
      } else if (exp.can_park_now === false) {
        errors.push(`${where}: expected.duration_minutes must be null when you can't park now`)
      } else if (exp.until === null) {
        errors.push(`${where}: expected.duration_minutes must be null when until is null`)
      } else {
        durationOk = true
      }
    }
    // The leave-by time and the minutes describe one answer: a leave-by in
    // the future, and the minutes from the scan time to it.
    if (scanMs !== null && exp.can_park_now === true && isIsoWithOffset(exp.until)) {
      const minutes = (Date.parse(exp.until) - scanMs) / 60_000
      if (!(minutes > 0)) {
        errors.push(`${where}: expected.until must be after scanContext.datetime`)
      } else if (durationOk && Math.abs(minutes - exp.duration_minutes) > TOLERANCE_MINUTES) {
        errors.push(
          `${where}: expected.duration_minutes is ${exp.duration_minutes}, but until is ${Math.round(minutes)} minutes after scanContext.datetime`,
        )
      }
    }
    if (exp.note !== undefined && typeof exp.note !== 'string') errors.push(`${where}: expected.note must be text`)
  }

  let variants = null
  if (raw.expected_variant !== undefined && raw.expected_variant !== null) {
    const list = Array.isArray(raw.expected_variant) ? raw.expected_variant : [raw.expected_variant]
    if (!list.length || !list.every((v) => typeof v === 'string' && v.trim())) {
      errors.push(`${where}: expected_variant must be a position label, or a list of accepted labels`)
    } else {
      variants = list
    }
  }

  let signStatus = null
  if (raw.expected_sign_status !== undefined && raw.expected_sign_status !== null) {
    if (!SIGN_STATUSES.includes(raw.expected_sign_status)) {
      errors.push(`${where}: expected_sign_status must be one of ${SIGN_STATUSES.join(', ')}`)
    } else {
      signStatus = raw.expected_sign_status
    }
  }

  const flags = {}
  if (raw.expected_flags !== undefined) {
    if (!isObject(raw.expected_flags)) {
      errors.push(`${where}: expected_flags must be an object`)
    } else {
      for (const [key, value] of Object.entries(raw.expected_flags)) {
        if (!FLAG_KEYS.includes(key)) {
          errors.push(`${where}: expected_flags.${key} is not a sign detail the harness scores`)
        } else if (BOOLEAN_FLAGS.has(key)) {
          if (typeof value !== 'boolean') errors.push(`${where}: expected_flags.${key} must be true or false`)
          else flags[key] = value
        } else if (key === 'permit_area') {
          if (value !== null && (typeof value !== 'string' || !value.trim())) {
            errors.push(`${where}: expected_flags.permit_area must be null or the area as printed`)
          } else flags[key] = value
        } else if (key === 'payment_methods') {
          if (value !== null && (!Array.isArray(value) || !value.every((m) => typeof m === 'string' && m.trim()))) {
            errors.push(`${where}: expected_flags.payment_methods must be null or a list of methods`)
          } else flags[key] = value
        }
      }
    }
  }

  if (errors.length) return { entry: null, errors, warnings }
  return {
    entry: {
      id: id.trim(),
      file,
      format,
      image: raw.image,
      media_type: mediaTypeFor(raw.image),
      split,
      tags: tags.map((t) => t.trim()),
      scanContext: { lat: ctx.lat, lng: ctx.lng, datetime: ctx.datetime },
      // The zone the sign reader will use for this scan.
      timezone,
      expected: { ...exp },
      expected_variant: variants,
      expected_sign_status: signStatus,
      expected_flags: flags,
    },
    errors,
    warnings,
  }
}

/**
 * Loads every <id>.json in `dir`. A label whose photo is missing is an
 * error, as is a repeated id. Returns `{ entries, errors, warnings }`, with
 * entries sorted by id so runs are in a stable order.
 */
export function loadCorpus(dir) {
  const entries = []
  const errors = []
  const warnings = []
  if (!existsSync(dir)) return { entries, errors, warnings }
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort()
  const seen = new Map()
  for (const file of files) {
    let raw
    try {
      raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (err) {
      errors.push(`${file}: not valid JSON (${err.message})`)
      continue
    }
    const result = normalizeEntry(raw, file)
    warnings.push(...result.warnings)
    if (!result.entry) {
      errors.push(...result.errors)
      continue
    }
    const entry = result.entry
    if (seen.has(entry.id)) {
      errors.push(`${file}: id "${entry.id}" is also used by ${seen.get(entry.id)}`)
      continue
    }
    seen.set(entry.id, file)
    if (!existsSync(join(dir, entry.image))) {
      errors.push(`${file}: photo "${entry.image}" not found next to the label`)
      continue
    }
    entries.push({ ...entry, image_path: join(dir, entry.image) })
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { entries, errors, warnings }
}

/** Entries in the chosen split: 'dev', 'test' or 'all'. */
export function filterSplit(entries, split) {
  return split === 'all' ? entries.slice() : entries.filter((e) => e.split === split)
}
