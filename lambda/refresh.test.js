// @vitest-environment node
//
// Lambda refresh-mode reasoning — text-only path. Skeleton — fill in tomorrow.
//
// Why this is in the suite: refresh mode skips the vision call and runs
// pure text reasoning over prior rules. That makes it 100% deterministic
// per (rules, time) pair AND high-stakes — Smart Re-Scan uses this path,
// and users trust the result without re-photographing. A regression here
// silently corrupts every reused session.
//
// These tests exercise translateSign() with the prior_rules branch. We do
// NOT mock Claude — we hit the real model with deterministic inputs and
// assert the structural shape of the response (can_park_now boolean,
// requires_disabled_permit boolean, until ISO format). The model is part
// of the system under test in refresh mode; the prompt's correctness is
// the whole point of testing it.
//
// Tagged it.todo because hitting the real API on every CI run is wasteful.
// Tomorrow's call: either (a) flip them to it() and rate-limit CI, or
// (b) cache a recorded response and re-run from fixture. The right answer
// is probably (b).

import { describe, it } from 'vitest'

describe('refresh mode — can_park_now logic', () => {
  it.todo('inside a 2P window → can_park_now=true, duration_minutes ≤ 120')
  it.todo('outside all windows on a "Mon-Fri 8am-6pm" rule + Saturday morning → free')
  it.todo('Clearway active → can_park_now=false, until=null')
  it.todo('Permit Zone without acknowledgement → can_park_now=false')
})

describe('refresh mode — ♿ permit gate (regression test for d9437fa)', () => {
  it.todo('♿-only bay inside active window → can_park_now=TRUE + requires_disabled_permit=TRUE')
  it.todo('♿-only bay outside its window, general parking applies → can_park_now=true, flag=false')
  it.todo('♿-only bay AND inside a Clearway window → can_park_now=false (Clearway wins)')
})

describe('refresh mode — payment_methods (regression test for a2b2b4f)', () => {
  it.todo('rules mentioning "Meter" populate payment_methods=["meter"] regardless of paid-window state')
  it.todo('rules with EasyPark explicit mention → payment_methods includes "easypark"')
  it.todo('a fully free sign → payment_methods=null')
})

describe('refresh mode — until computation (HOW TO COMPUTE \'until\')', () => {
  it.todo('takes EARLIEST leave-by across all rules on the sign')
  it.todo('time-limited inside window — leave-by = now + duration, capped at end of window')
  it.todo('time-limited outside window — leave-by = (start of next window) + duration')
  it.todo('multi-rule sanity: 2P Mon-Fri 8am-6pm + Permit Zone Sat-Sun → take earlier, not later')
})

describe('refresh mode — output shape contract', () => {
  it.todo('always returns the full ParkingRules schema (no missing required fields)')
  it.todo('rules and observations are echoed back unchanged from prior_*')
  it.todo('confidence is "high" when rules + chosen_label both supplied')
  it.todo('clarification is null in refresh mode (already resolved on the prior scan)')
})
