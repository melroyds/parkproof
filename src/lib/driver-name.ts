// "Who's driving?" on each record (build spec T7 item 1).
import type { LogDraft } from '../types'
import { CAPS } from '../../lambda/addendum-schema.js'
import { fitText } from './evidence-chain'
import { logDraftFromProfile } from './profile'
import { loadProfile } from './storage'

/** The longest driver name a record keeps (and signs in arrival_context). */
export const DRIVER_NAME_MAX = CAPS.driverName

/**
 * What the logger's "Who's driving?" field starts with: the draft's driver
 * when the scan views carried one (App starts every scan's draft from
 * Settings with logDraftFromProfile), otherwise the name saved in Settings
 * (T4: `parkproof.profile.v1`, "Your name on records you share"), read now.
 * The no-sign logger has no draft, so it takes the Settings name here.
 * Empty when neither names anyone.
 *
 * The field's value is what the record saves (`savedDriverName`), even
 * when cleared, and applyLogDraftDefaults never puts the Settings name back
 * over it: the logger's explicit value, even null, wins.
 */
export function defaultDriverName(
  draft: Pick<LogDraft, 'driver_name'> | null | undefined,
  settingsDraft: () => Pick<LogDraft, 'driver_name'> = () => logDraftFromProfile(loadProfile()),
): string {
  return fitText(draft?.driver_name, DRIVER_NAME_MAX) ?? fitText(settingsDraft().driver_name, DRIVER_NAME_MAX) ?? ''
}

/**
 * The driver name a record saves from the field: shaped to fit the signed
 * field (control characters removed, trimmed, at most 60 characters), or
 * null when empty. A cleared field saves null, so the record (and its
 * signed arrival_context) says nobody was named rather than falling back
 * to a default.
 */
export function savedDriverName(value: string): string | null {
  return fitText(value, DRIVER_NAME_MAX)
}

/** How many characters of the name the logger's closed "Who's driving?" toggle shows. */
export const DRIVER_BADGE_MAX = 24

/**
 * The name on the logger's closed "Who's driving?" toggle: what the record
 * will save (as `savedDriverName` shapes it), cut to DRIVER_BADGE_MAX
 * characters with an ellipsis so it fits beside the title, or null when
 * nobody is named. The whole name shows once the section is opened.
 */
export function driverBadgeText(value: string): string | null {
  const name = savedDriverName(value)
  if (!name) return null
  const chars = Array.from(name)
  return chars.length > DRIVER_BADGE_MAX ? `${chars.slice(0, DRIVER_BADGE_MAX - 1).join('').trimEnd()}…` : name
}
