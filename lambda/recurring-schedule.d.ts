// Types for lambda/recurring-schedule.js, which the browser imports too
// (src/lib/recurring.ts). The stored rule itself is RecurringRule in
// src/types.ts; this file only types the module's API.

export type RecurringWeekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
export type RecurringFrequencyName = 'weekly' | 'fortnightly' | 'monthly_nth'
export type RecurringPushReminder = 'evening' | 'before'

export interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/** The fields occursOn() reads. */
export interface RecurringCalendarRule {
  days: readonly RecurringWeekday[]
  frequency: RecurringFrequencyName
  nth: readonly number[]
  anchor_date: string
}

/** The schedule part of a rule the server books and decides from. */
export interface RecurringScheduleRule extends RecurringCalendarRule {
  id: string
  days: RecurringWeekday[]
  nth: number[]
  start: string
  timezone: string
  remind_evening_before: string | null
  remind_minutes_before: number | null
}

export declare const WEEKDAYS: readonly RecurringWeekday[]
export declare const RECURRING_FREQUENCIES: readonly RecurringFrequencyName[]
export declare const HHMM_RE: RegExp

export function isValidTimeZone(timeZone: unknown): timeZone is string
export function canonicalTimeZone(timeZone: string): string
export function zonedWallClock(instant: Date | number, timeZone: string): WallClock
export function zonedWallClockToUtc(w: WallClock, timeZone: string): Date
export function localDateInZone(instant: Date | number, timeZone: string): string

export function parseLocalDate(s: unknown): { year: number; month: number; day: number } | null
export function dayNumber(date: string): number
export function dateOfDayNumber(n: number): string
export function weekdayOfDayNumber(n: number): RecurringWeekday
export function minutesOfDay(hhmm: string): number
export function occursOn(rule: RecurringCalendarRule, date: string): boolean
export function recurringReminderTag(ruleId: string, fireAt: Date | number): string

export declare const RECURRING_PUSH_NAME_PREFIX: 'parkproof-push-r-'
export declare const SCHEDULE_NAME_MAX: 64
export declare const RECURRING_PUSH_REMINDERS: readonly RecurringPushReminder[]
export declare const RECURRING_PUSH_SLOTS: number
export declare const RECURRING_SCHEDULE_DAYS: number
export declare const RECURRING_STALE_AFTER_START_MS: number
/** When a weekly reminder stops being worth showing (ms): the start for 'evening', 15 minutes after it for 'before'. */
export function recurringReminderStaleAt(reminder: RecurringPushReminder, startMs: number): number
export declare const RECURRING_COPY_CAPS: Readonly<{ title: number; body: number; url: number }>

export function recurringScheduleName(ruleId: string, slot: number): string
export function recurringScheduleNames(ruleId: string): string[]
export function recurringTopicId(ruleId: string): string

export interface RecurringCronPlan {
  slot: number
  name: string
  reminder: RecurringPushReminder
  /** Wall-clock minutes from the fire time to the start. */
  lead_minutes: number
  fire_days: RecurringWeekday[]
  /** 'HH:MM' in the rule's zone. */
  fire_time: string
  /** EventBridge Scheduler cron(), read in the rule's zone. */
  expression: string
}

export function recurringCronPlans(
  rule: Pick<RecurringScheduleRule, 'id' | 'days' | 'start' | 'remind_evening_before' | 'remind_minutes_before'>,
): RecurringCronPlan[]

export function occurrenceDateForFire(
  fireMs: number,
  timeZone: string,
  leadMinutes: number,
): { date: string; weekday: RecurringWeekday }

export function parseRecurringRule(raw: unknown): { ok: true; rule: RecurringScheduleRule } | { ok: false; error: string }

/** Notification words per reminder, one body per rule day. */
export type RecurringCopyByDay = Partial<Record<RecurringWeekday, string>>

export interface RecurringPushCopy {
  title: string
  url: string
  bodies: Partial<Record<RecurringPushReminder, RecurringCopyByDay>>
}

export function parseRecurringPushRequest(
  body: unknown,
): { ok: true; rule: RecurringScheduleRule; copy: RecurringPushCopy } | { ok: false; error: string }

export interface RecurringDispatchInput {
  _async_kind: 'push-recurring'
  device_id: string
  rule_id: string
  slot: number
  reminder: RecurringPushReminder
  lead_minutes: number
  scheduled_time: string
  rule: Pick<RecurringScheduleRule, 'days' | 'start' | 'frequency' | 'nth' | 'anchor_date' | 'timezone'>
  title: string
  url: string
  bodies: RecurringCopyByDay | undefined
}

export function recurringDispatchInput(args: {
  device_id: string
  rule: RecurringScheduleRule
  copy: RecurringPushCopy
  plan: RecurringCronPlan
}): RecurringDispatchInput

export interface RecurringPushMessage {
  device_id: string
  session_id: string
  title: string
  body: string
  url: string
  tag: string
  kind: 'recurring'
  stale_at: string
}

export type RecurringDispatchDecision =
  | { send: false; reason: 'bad_input' | 'no_occurrence' | 'no_copy' | 'stale'; date?: string }
  | { send: true; date: string; occurrence_start: string; message: RecurringPushMessage }

export function recurringDispatchDecision(input: unknown, nowMs: number): RecurringDispatchDecision
