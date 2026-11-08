import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNow } from './lib/use-now'
import SignScanner from './components/SignScanner'
import ParkingResult from './components/ParkingResult'
import Clarify from './components/Clarify'
import SessionLogger from './components/SessionLogger'
import ReminderOptions from './components/ReminderOptions'
import SessionHistory from './components/SessionHistory'
import SessionDetail from './components/SessionDetail'
import AppealFlow from './components/AppealFlow'
import NoticeLookup from './components/NoticeLookup'
import ActiveSessionCard from './components/ActiveSessionCard'
import ActiveSessionsList from './components/ActiveSessionsList'
import AuthFlow from './components/AuthFlow'
import AuthSettings from './components/AuthSettings'
import PrivacyPolicy from './components/PrivacyPolicy'
import FeedbackModal from './components/FeedbackModal'
import DepartureSheet from './components/DepartureSheet'
import LandingFeatures from './components/LandingFeatures'
import AboutFeatures from './components/AboutFeatures'
import LanguageSelector from './components/LanguageSelector'
import BrandMark from './components/BrandMark'
import Icon from './components/Icon'
import LoadingProgress from './components/LoadingProgress'
import { refreshInterpretation, translateSign } from './lib/claude'
import {
  deleteSession,
  endSession,
  getSession,
  isDuplicateRecordError,
  isStorageFullError,
  loadActiveSessions,
  loadSessionIdsForGc,
  loadSessions,
  notifyRecordsChanged,
  saveSession,
  subscribeStorageRecovered,
  updateSession,
} from './lib/storage'
import { deleteSessionPhotos, sweepOrphanPhotos } from './lib/photo-store'
import {
  getSessionPhoto,
  notifyPhotoSourceChanged,
  reusedPhotoMeta,
  setRemotePhotoFetcher,
  type PhotoCaptureMeta,
} from './lib/session-photos'
import { useRecordsVersion } from './lib/use-records-version'
import {
  holdAddendumSigning,
  installSigningTriggers,
  prepareNewRecord,
  releaseAddendumSigning,
  runSigningSweep,
  scheduleDepartureCatchUp,
  setSignedRecordListener,
  signNewRecord,
} from './lib/signing'
import { emptyLogDraft } from './lib/evidence-chain'
import { completeDeparture, requestDepartureFix, type DepartureFixRequest } from './lib/departure'
import { HOME_SCAN_ID, RECORD_STATUS_ID, firstFocusTarget } from './lib/focus-targets'
import { useAuth } from './lib/use-auth'
import { authConfigured } from './lib/auth'
import {
  createSyncRunner,
  deleteCloudSession,
  fetchRefPhotoFromCloud,
  installSyncOnReturn,
  mirrorSessionToCloud,
  mirrorSessionUpdateToCloud,
  performInitialSync,
  type InitialSyncResult,
} from './lib/sync'
import { handleCallback as handleFederatedCallback } from './lib/federated-auth'
import { cancelPushReminders, installPushRegistrationRefresh } from './lib/push'
import { cancelInTabReminders } from './lib/notifications'
import { clearDeepLinkParams, parseDeepLink } from './lib/deep-link'
import type { CapturedNotice, NoticeSnapshot } from './lib/notice-read'
import type { LogDraft, ParkingRules, ParkingSession, RuleVariant } from './types'

type Coords = { lat: number; lng: number } | null

interface ScanView<N extends 'clarify' | 'result' | 'logging'> {
  name: N
  result: ParkingRules
  signPhoto: string
  signPhotoMeta: PhotoCaptureMeta
  coords: Coords
  draft: LogDraft
}

type View =
  | { name: 'home' }
  | { name: 'scan' }
  | { name: 'loading' }
  /**
   * The scan-to-save views carry a LogDraft: what the driver has told us
   * so far for the record about to be logged. It starts empty for every
   * scan; later tasks add data to a new record only through it, and it
   * reaches the record's signed arrival_context at save.
   *
   * `signPhotoMeta` is when and how the sign photo was captured (camera or
   * library), carried to the logger for the photo's PhotoRef.
   */
  | ScanView<'clarify'>
  | ScanView<'result'>
  | ScanView<'logging'>
  /**
   * "No sign here" flow — user parked at a spot with no signage and wants a
   * GPS + time evidence record without the AI translation. The ambient photo
   * (optional, opt-in) demonstrates absence of signs.
   */
  | { name: 'logNoSign'; coords: Coords; ambientPhoto: string | null; ambientPhotoMeta: PhotoCaptureMeta | null }
  | { name: 'remind'; session: ParkingSession }
  | { name: 'history' }
  | { name: 'actives' }
  | { name: 'session'; session: ParkingSession }
  /**
   * The appeal flow. From the notice lookup it carries the notice photo
   * (`notice`, so the flow skips its capture step) and the lookup's state
   * (`returnTo`, so Back returns to the same matches without reading the
   * notice again).
   */
  | { name: 'appeal'; session: ParkingSession | null; notice?: CapturedNotice; returnTo?: NoticeSnapshot }
  /**
   * "Got a fine? Start here" (build spec T8): read a notice photo, show its
   * fields and the records from around its time, compare, and act.
   * `snapshot` is a notice already read (back from the appeal flow).
   */
  | { name: 'notice'; snapshot: NoticeSnapshot | null }
  | { name: 'signin' }
  | { name: 'settings' }
  | { name: 'privacy' }
  | { name: 'about' }
  | { name: 'error'; message: string; offline?: boolean }

/**
 * The departure sheet while it is open: the record being ended, the GPS fix
 * started when the sheet opened, and the on-time confirm text of the screen
 * the driver came from.
 */
interface DepartureSheetState {
  session: ParkingSession
  fix: DepartureFixRequest
  confirmKey: 'active.iveLeftConfirm' | 'session.endConfirm'
}

function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
}

/** True when the browser reports no network — drives the offline error state. */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Settle a cloud sync run: the start/sign-in sync, the retry and the pull
 * on return all end here. Records already told open screens as they landed
 * (sync.ts); this adds the end-of-run notification and the signing release.
 * `setUnreachable` drives the "couldn't reach your records" banner: set
 * when a run fails with nothing local to show, cleared when a later run
 * (a pull on return, say) reaches the cloud.
 */
function settleSyncRun(run: Promise<InitialSyncResult>, setUnreachable: (unreachable: boolean) => void): void {
  void run
    .then((res) => {
      // Couldn't reach the cloud AND nothing local to fall back on → a
      // returning user on a fresh device would otherwise see the first-time
      // landing with no clue their data is fine in the cloud. Offer a retry.
      if (res.listFailed && loadSessions().length === 0) setUnreachable(true)
      else if (!res.listFailed) setUnreachable(false)
    })
    .catch((err) => {
      console.warn('[sync] initial sync failed:', err)
      if (loadSessions().length === 0) setUnreachable(true)
    })
    .finally(() => {
      // Load-bearing (see CLAUDE.md gotchas): re-renders home after a pull.
      notifyRecordsChanged()
      // The cloud copies are merged in: sign the addenda held since start.
      releaseAddendumSigning()
    })
}

/**
 * Transient bottom-of-screen notice. Used for save-time events the user would
 * otherwise never learn about: a photo that failed to back up to the cloud, or
 * evidence photos stripped to recover localStorage quota.
 */
function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="fixed safe-bottom-4 safe-inset-x-4 z-50 max-w-md mx-auto bg-ink-900 text-white rounded-xl shadow-sm p-4 flex items-start gap-3"
    >
      <p className="text-sm leading-relaxed flex-1">{message}</p>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="text-white/70 hover:text-white text-sm font-semibold shrink-0 min-w-[44px] min-h-[44px] inline-flex items-center justify-center -my-2.5 -mr-2"
      >
        ✕
      </button>
    </div>
  )
}

function App() {
  // Deep link from a reminder notification (?session=) or the landing footer
  // (?privacy=open, ?feedback=open). Read once, at first render, so the first
  // paint is the right screen; the effect below then cleans the URL.
  const [initialLink] = useState(() =>
    typeof window === 'undefined' ? null : parseDeepLink(window.location.search),
  )
  const [view, setView] = useState<View>(() => {
    if (initialLink?.kind === 'session') {
      const linked = loadSessions().find((s) => s.id === initialLink.sessionId)
      if (linked) return { name: 'session', session: linked }
    }
    if (initialLink?.kind === 'privacy') return { name: 'privacy' }
    return { name: 'home' }
  })
  const [feedbackOpen, setFeedbackOpen] = useState(() => initialLink?.kind === 'feedback')
  useEffect(() => {
    if (initialLink) clearDeepLinkParams()
  }, [initialLink])
  // Transient save-time notice (quota recovery, photo-sync failure). Auto-clears.
  const [notice, setNotice] = useState<string | null>(null)
  // The "I've left" departure sheet, open over home or the record screen.
  const [departureSheet, setDepartureSheet] = useState<DepartureSheetState | null>(null)
  // Set when a signed-in user's first cloud sync couldn't reach their sessions,
  // so the home view offers a retry instead of silently showing the first-time
  // landing as if they had no data.
  const [syncError, setSyncError] = useState(false)
  const auth = useAuth()
  const { t } = useTranslation()

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 7000)
    return () => clearTimeout(id)
  }, [notice])

  // Any write that only fitted after quota recovery stripped photos from or
  // deleted older records tells the driver, including the background
  // evidence-chain writes (link 0 and link 1 bundles, the departure
  // catch-up) that land after the save itself. Silently deleting evidence
  // contradicts the whole "your evidence is safe" promise. Whole records
  // deleted is the bigger loss, so it gets its own message.
  useEffect(
    () =>
      subscribeStorageRecovered((report) => {
        console.info(
          `[storage] freed space: stripped photos from ${report.trimmedPhotosFrom}, evicted ${report.evicted} old record(s).`,
        )
        setNotice(
          report.evicted > 0
            ? t('errors.storageEvicted', { count: report.evicted })
            : t('errors.storageRecovered', { count: report.trimmedPhotosFrom }),
        )
      }),
    [t],
  )

  // OAuth federation callback splash. When Apple / Google sign-in completes,
  // the browser lands here with ?code=<auth-code>&state=<csrf-token> in the
  // URL. The token exchange + refresh runs in the useEffect below, which
  // takes a beat. Previously, that beat rendered the default home view —
  // first-time visitors briefly saw the marketing landing during their own
  // sign-in flow, returning users saw their session card flash, both of
  // which read as broken.
  //
  // We detect callback state at INITIAL render (lazy useState initializer)
  // so the very first paint is the splash, not the wrong view. The
  // useEffect below releases the splash on completion (success OR failure
  // — we never want to strand the user on a loading screen).
  const [oauthCallbackPending, setOauthCallbackPending] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const params = new URLSearchParams(window.location.search)
      // Both params present on Cognito Hosted UI redirects. Either alone is
      // suspicious (probably a manual URL edit) but we still show the splash
      // to be safe — handleFederatedCallback will no-op gracefully if there's
      // nothing to exchange.
      return params.has('code') || params.has('state')
    } catch {
      return false
    }
  })

  // Hooks must run unconditionally on every render — keep these above the
  // view-name early-returns. The home view consumes them; non-home views
  // pay a negligible cost (one localStorage read + a 30s interval).
  const now = useNow(30_000)
  // `activesVersion` changes on every write to the saved records (the
  // parkproof:records-changed event that storage.ts dispatches), forcing a
  // re-derive of the active list when data changes but `now` doesn't.
  // Without it, the home card can linger for up to 30 seconds after the
  // user taps "I've left".
  const activesVersion = useRecordsVersion()
  const activeSessions = useMemo(
    () => loadActiveSessions(now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now, activesVersion],
  )

  // The signing sweep: on app start, and again when the browser comes back
  // online or the page becomes visible, sign anything still outstanding
  // (link 0 left unsigned by a closed tab, pending addenda, a departure to
  // catch up). Throttled per record inside the helper.
  //
  // Where sign-in is set up, addenda wait until the first cloud sync has
  // merged in links signed on the driver's other devices (it can renumber
  // this device's pending links on top of them); signing one first could
  // fork the chain. Link 0 is signed at once. The hold ends when that sync
  // settles, or as soon as it is clear nobody is signed in (both below).
  useEffect(() => {
    if (authConfigured()) holdAddendumSigning()
    runSigningSweep()
    return installSigningTriggers()
  }, [])
  useEffect(() => {
    if (!auth.loading && !auth.user) releaseAddendumSigning()
  }, [auth.loading, auth.user])

  // Push registration refresh (field-test fix list, item 1): the server can
  // forget this phone (90-day expiry, or a first save that failed) while
  // the browser still holds its subscription, and reminders booked then
  // were dropped. Re-send the registration on start and when the app comes
  // back to the screen. Fire-and-forget, only with notifications allowed
  // and a subscription present, at most hourly.
  useEffect(() => installPushRegistrationRefresh(), [])

  // Photo-store GC on app start: delete photos whose record no longer
  // exists, once they are at least a day old (a logger open in another tab
  // stores its photos before its record is saved). Skipped when the saved
  // records can't be read right now: an unreadable list is not an empty
  // one, and sweeping against it would delete every photo on the device.
  useEffect(() => {
    const knownIds = loadSessionIdsForGc()
    if (!knownIds) {
      console.warn('[photos] startup sweep skipped: the saved records could not be read')
      return
    }
    void sweepOrphanPhotos(knownIds)
      .then((n) => {
        if (n > 0) console.info(`[photos] removed ${n} photo(s) of records that no longer exist`)
      })
      .catch((err) => console.warn('[photos] startup sweep failed:', err))
  }, [])

  // If the browser landed here as a federated-sign-in callback (?code=…),
  // exchange the code for tokens and refresh the auth context. Runs once
  // per mount; the helper no-ops when there's no code in the URL.
  useEffect(() => {
    void (async () => {
      try {
        const handled = await handleFederatedCallback()
        if (handled) {
          // Replace the OAuth callback URL with the canonical app path.
          // The browser landed at /auth/callback?code=... (Cognito's
          // whitelisted redirect URI), CloudFront rewrote that to
          // /app/index.html so the SPA could mount, and now we want the
          // URL bar to reflect where the user actually IS — the React
          // PWA at /app/ — not the OAuth callback path. Replacing rather
          // than pushing means there's no back-button stop on the dead
          // /auth/callback URL.
          window.history.replaceState({}, '', '/app/')
          await auth.refresh()
        }
      } catch (err) {
        console.warn('[auth] federated callback failed:', err)
      } finally {
        // Always release the splash, even on error — leaving the user
        // stranded on a loading screen is worse than dropping them on
        // the home view with a stale ?code= in the URL. The auth context
        // will still be unauthenticated in the error case, so the home
        // view will surface its normal sign-in CTA.
        setOauthCallbackPending(false)
      }
    })()
    // Mount-only — refresh is stable across renders for our purposes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Run a local↔cloud merge the first time the user becomes signed-in in
  // this session. Subsequent saves are mirrored individually by handleSessionSaved.
  // Keyed on user-id so the sync fires exactly once per sign-in; the lint
  // wants the whole `auth.user` object on the dep list, but that would
  // re-fire on every refresh() call (unnecessary).
  //
  // After the sync settles (success OR error) we fire a records-changed
  // notification so the home view re-derives. Without this, a signed-in user
  // on a fresh device sees the "first-time visitor" LandingFeatures forever:
  // sessionCount is computed inline at render time. Records now also notify
  // as they land (sync.ts), so open screens update mid-sync, but this
  // end-of-run notification stays: it is the one the gotcha depends on.
  const userId = auth.user?.userId
  // One sync at a time for the app's lifetime: the start/sign-in sync, the
  // retry and the pull on return all go through it (sync.ts createSyncRunner).
  const [cloudSync] = useState(() => createSyncRunner(performInitialSync))
  const runInitialSync = () => {
    if (!userId) return
    // Note: syncError is cleared by the retry handler, NOT synchronously
    // here. Calling setState synchronously from the mount effect that invokes
    // this would trip the cascading-render lint rule. The async branches in
    // settleSyncRun are fine: they set it, and clear it once a run (the pull
    // on return, too) reaches the cloud.
    settleSyncRun(cloudSync.now(), setSyncError)
  }
  // A photo whose bytes aren't on this device (a record pulled from the
  // cloud, or IndexedDB cleared) is fetched from the signed-in driver's
  // cloud copy, checked against its fingerprint and kept here. The source
  // is installed once, not on sign-in: it waits for the sign-in itself
  // (and answers "missing" while signed out), so a screen painted before
  // sign-in resolves still gets its photos. A sign-in tells every photo
  // that came out missing to ask again.
  useEffect(() => {
    setRemotePhotoFetcher(fetchRefPhotoFromCloud)
    return () => setRemotePhotoFetcher(null)
  }, [])
  useEffect(() => {
    if (userId) notifyPhotoSourceChanged()
  }, [userId])
  useEffect(() => {
    runInitialSync()
    // Mount / sign-in only — keyed on userId. runInitialSync is recreated each
    // render, so listing it as a dep would re-sync on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])
  // Pull on return (field-test fix list, Tier 2): while signed in, sync
  // again when the app comes back to the screen or back online, so a record
  // ended or added on another device shows up without a reload. At most
  // once a minute, and never while a sync is already running.
  useEffect(() => {
    if (!userId) return
    return installSyncOnReturn(cloudSync, (run) => settleSyncRun(run, setSyncError))
  }, [userId, cloudSync])

  // Whenever signing stores a new bundle (at save or from a background
  // retry), mirror the record to the cloud while signed in.
  useEffect(() => {
    setSignedRecordListener(userId ? (id) => mirrorSessionUpdateToCloud(id) : null)
    return () => setSignedRecordListener(null)
  }, [userId])

  const handleCapture = async (
    dataUrl: string,
    mediaType: string,
    coords: { lat: number; lng: number } | null,
    meta?: PhotoCaptureMeta,
  ) => {
    // Without capture metadata, claim no more than we know: now, and not
    // necessarily from the camera.
    const signPhotoMeta: PhotoCaptureMeta = meta ?? { captured_at: new Date().toISOString(), source: 'library' }
    setView({ name: 'loading' })
    try {
      const base64 = stripDataUrlPrefix(dataUrl)
      const result = await translateSign(base64, mediaType, coords)
      const draft = emptyLogDraft()
      if (result.clarification && result.clarification.options.length > 1) {
        setView({ name: 'clarify', result, signPhoto: dataUrl, signPhotoMeta, coords, draft })
      } else {
        setView({ name: 'result', result, signPhoto: dataUrl, signPhotoMeta, coords, draft })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setView({ name: 'error', message, offline: isOffline() })
    }
  }

  const handlePickVariant = (
    variant: RuleVariant,
    base: ParkingRules,
    signPhoto: string,
    signPhotoMeta: PhotoCaptureMeta,
    coords: Coords,
    draft: LogDraft,
  ) => {
    const alternates =
      base.clarification?.options.filter((o) => o.label !== variant.label) ?? []
    const merged: ParkingRules = {
      ...base,
      rules: variant.rules,
      observations: variant.observations,
      can_park_now: variant.can_park_now,
      until: variant.until,
      duration_minutes: variant.duration_minutes,
      // Variant carries its own transition awareness — use it in preference
      // to the top-level one (which describes the unmerged combined rule).
      next_transition: variant.next_transition ?? base.next_transition ?? null,
      // Disability-permit requirement is per-variant on multi-arrow signs
      // (left = general, right = ♿ only). Carry the chosen variant's flag
      // up to the top-level result so the ParkingResult gate fires only
      // when the side the user actually picked is permit-restricted.
      requires_disabled_permit: variant.requires_disabled_permit ?? false,
      // Permit-zone flag + area work the same way — variant-scoped on signs
      // where one side is permit-zone and another is general parking, so
      // the gate only fires when the chosen side is actually permit-restricted.
      is_permit_zone: variant.is_permit_zone ?? false,
      permit_area: variant.permit_area ?? null,
      clarification: null,
      chosen_label: variant.label,
      alternate_variants: alternates,
    }
    setView({ name: 'result', result: merged, signPhoto, signPhotoMeta, coords, draft })
  }

  // A re-check in progress. Reading the sign photo (an IndexedDB read)
  // happens before the view switches to `loading`, and meanwhile the
  // re-check buttons are still on screen: a second tap must not start a
  // second refresh (another model call, and the later answer would win).
  const reuseInFlight = useRef(false)

  const handleReuseSession = async (session: ParkingSession) => {
    if (reuseInFlight.current) return
    reuseInFlight.current = true
    try {
      await reuseSession(session)
    } finally {
      reuseInFlight.current = false
    }
  }

  const reuseSession = async (session: ParkingSession) => {
    // A re-check needs the earlier sign photo for the result screen. Without
    // one (no-sign record, photo stripped by quota recovery, or photo-store
    // bytes not on this device) send the driver to a fresh scan instead.
    // Checked BEFORE switching to `loading`: returning from the loading view
    // used to leave the spinner up forever.
    const signPhoto = await getSessionPhoto(session, 'sign')
    if (!signPhoto) {
      setView({ name: 'scan' })
      return
    }
    // The new record reuses this photo: carry its own capture time and source.
    const signPhotoMeta = reusedPhotoMeta(session, 'sign')
    setView({ name: 'loading' })
    try {
      const fresh = await refreshInterpretation(
        {
          rules: session.rules,
          observations: session.observations,
          chosen_label: session.chosen_label,
        },
        session.location,
      )
      // Trust the model only for current-time fields. Everything else is the
      // user-verified prior reading — we don't want the model to "re-creatively"
      // change observations, rules text, or the chosen variant.
      const result: ParkingRules = {
        ...fresh,
        rules: session.rules,
        observations: session.observations,
        confidence: 'high',
        clarification: null,
        chosen_label: session.chosen_label,
        // A re-check, for the feedback telemetry. Set here as well as in
        // refreshInterpretation so it survives this object being rebuilt.
        is_refresh: true,
      }
      // Reuse the prior session's coords for the result view — they're a
      // strict superset of what handleCapture would pass and they correctly
      // anchor the result-screen timezone to where the user was parked.
      const reusedCoords: Coords = session.location
        ? { lat: session.location.lat, lng: session.location.lng }
        : null
      setView({ name: 'result', result, signPhoto, signPhotoMeta, coords: reusedCoords, draft: emptyLogDraft() })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setView({ name: 'error', message, offline: isOffline() })
    }
  }

  const handleSessionSaved = async (logged: ParkingSession, draft: LogDraft) => {
    // The record's chain key and link-0 photo hashes are set at save, so
    // link 0 can always be signed later even if the photos are gone. Never
    // throws; without hashes, link 0 hashes the photos when it signs.
    const session = await prepareNewRecord(logged)
    try {
      // If quota recovery had to strip or evict older records to fit, the
      // storage-recovered listener above tells the driver. We don't block
      // them: they get straight to the reminder screen, where the notice
      // shows, and History reflects the cleanup on next render.
      saveSession(session)
      // No-sign sessions skip the reminder step — there's no expiry to remind
      // about. They go straight back to the home screen, where the saved
      // session is visible in History.
      // No-sign sessions used to skip ReminderOptions because the picker
      // only knew about "X min before expiry" and there's no expiry on a
      // no-sign session. The picker now supports an open-ended "remind
      // me in N hours" mode, so route everyone through it — the driver
      // can pick "1 hour" / "4 hours" / etc. to check on their car.
      setView({ name: 'remind', session })
      // No manual re-derive needed: saveSession fired records-changed, so
      // the home card picks the new record up without waiting for a tick.
      // Mirror to cloud immediately when signed in. Local is the source of
      // truth, the cloud is a best-effort backup — but if the metadata synced
      // and a PHOTO didn't, the row exists with a missing image (blank PDF,
      // missing photo cross-device). That used to be swallowed silently; now we
      // flag the session and tell the user so they can retry.
      if (auth.user) {
        void mirrorSessionToCloud(session).then((res) => {
          if (res.photoFailed) {
            try {
              updateSession(session.id, { photo_sync_failed: true })
            } catch (e) {
              console.warn('[sync] could not flag photo-sync failure:', e)
            }
            setNotice(t('errors.photoSyncFailed'))
          }
        })
      }
      // Start the evidence chain in the background, never blocking the
      // reminder flow: queue the arrival_context (link 1, from the record and
      // the draft), then sign link 0 and link 1 on the record's queue. Each
      // bundle lands in storage (records-changed re-renders the screens) and
      // the signed-record listener mirrors it to the cloud when signed in.
      // A closed tab or a network failure is picked up by the sweep.
      signNewRecord(session.id, draft)
    } catch (err) {
      // The same record saved twice (a repeated save of one logger): the
      // record IS saved, so leave it, and its photos, alone, and move on as
      // a save does, to its reminders. (Staying here would leave the driver
      // on a logger whose Save is disabled.)
      if (isDuplicateRecordError(err)) {
        console.warn('[storage] record already saved:', session.id)
        const saved = getSession(session.id)
        if (saved) setView({ name: 'remind', session: saved })
        return
      }
      // Not saved, so nothing refers to the photos the logger stored. (Only
      // when the record really isn't there: a failure after the save must
      // never take a saved record's photos with it.)
      if (!getSession(session.id)) {
        void deleteSessionPhotos(session.id).catch((e) =>
          console.warn('[photos] could not delete the photos of an unsaved record:', e),
        )
      }
      // Storage full after recovery: a translated message, not the English
      // log text the error carries.
      const message = isStorageFullError(err)
        ? t('errors.storageFull')
        : err instanceof Error
          ? err.message
          : String(err)
      setView({ name: 'error', message })
    }
  }

  /**
   * The ONE end-session path, run by "Confirm I've left" on the departure
   * sheet. The home card and the record screen only ask (they open the
   * sheet); this stamps ended_at with the tap time, mirrors the change to
   * cloud when signed in, and cancels push and in-tab reminders. The
   * records-changed event from the write makes the home card disappear
   * (and the record screen show "Ended ...") immediately rather than after
   * the next 30s tick.
   *
   * Non-destructive: the record stays in history with the ended-at stamp
   * preserved for the evidence record. A record that is already ended, or
   * gone, is left alone, so a double tap can't move the first tap's time.
   * Returns the stamped ended_at, or null when nothing was ended.
   */
  const handleEndSession = (session: ParkingSession): string | null => {
    const current = getSession(session.id)
    if (!current || current.ended_at) return null
    const endedAt = new Date()
    try {
      endSession(session.id, endedAt)
    } catch (err) {
      console.warn('[storage] could not end session:', err)
      return null
    }
    try {
      if (auth.user) mirrorSessionUpdateToCloud(session.id)
      // Fire-and-forget: cancel any pending Web Push reminders for this
      // session server-side. Without this, EventBridge would keep firing
      // pushes ("30 min until parking expires") after the user has already
      // left — annoying and undermines trust in the reminders. Best-effort:
      // the local ended_at stamp is the source of truth; if the cancel
      // network call fails, the worst case is a stale push fires later.
      // Once the schedules are really gone, clear the cached list too, so
      // the record screen stops listing reminders that won't fire. After a
      // failure (or reminders owned by another device) the list stays,
      // because those pushes may still arrive.
      void cancelPushReminders(session.id).then((res) => {
        if (!res.ok || !getSession(session.id)?.push_reminders?.length) return
        try {
          updateSession(session.id, { push_reminders: [] })
          if (auth.user) mirrorSessionUpdateToCloud(session.id)
        } catch (err) {
          console.warn('[reminders] could not clear cancelled reminders:', err)
        }
      })
      // Same for reminders armed in this tab, or a stale "move your car"
      // fires after the driver has gone.
      cancelInTabReminders(session.id)
      // The departure catch-up: once the grace period has passed, queue a
      // departure addendum for the tap time (no location) unless the
      // departure flow queued its own meanwhile. Also marks the record as
      // ended on this device, so the sweep covers a tab that closes first.
      scheduleDepartureCatchUp(session.id)
    } catch (err) {
      console.warn('[storage] could not finish ending the record:', err)
    }
    return endedAt.toISOString()
  }

  /**
   * "I've left" on the home card or the record screen: open the departure
   * sheet and start the GPS fix straight away, so it is likely in by the
   * time the driver confirms. Nothing is stored until "Confirm I've left".
   */
  const openDepartureSheet = (
    session: ParkingSession,
    confirmKey: DepartureSheetState['confirmKey'],
  ) => {
    const current = getSession(session.id)
    if (!current || current.ended_at || departureSheet) return
    setDepartureSheet({ session: current, fix: requestDepartureFix(), confirmKey })
  }

  /**
   * "Confirm I've left": end the record now (the tap time is ended_at) and
   * close the sheet at once. In the background, wait up to 8 s for the
   * fix, then save the record's departure and queue the signed departure
   * addendum (completeDeparture). A tab closed before that is covered by
   * the departure catch-up.
   */
  const confirmDeparture = () => {
    const sheet = departureSheet
    setDepartureSheet(null)
    if (!sheet) return
    const endedAt = handleEndSession(sheet.session)
    if (!endedAt) return
    const signedIn = !!auth.user
    void completeDeparture(sheet.session.id, endedAt, sheet.fix, {
      onRecordUpdated: (id) => {
        if (signedIn) mirrorSessionUpdateToCloud(id)
      },
    })
  }

  const departureSheetView = departureSheet ? (
    <DepartureSheet
      session={departureSheet.session}
      fix={departureSheet.fix}
      confirmKey={departureSheet.confirmKey}
      onConfirm={confirmDeparture}
      onCancel={() => setDepartureSheet(null)}
      // Confirm ends the record, which removes the I've left button that
      // opened the sheet: focus goes to the record screen's status ("Ended")
      // or, on home, the scan button.
      returnFocus={() => firstFocusTarget(RECORD_STATUS_ID, HOME_SCAN_ID)}
    />
  ) : null

  /**
   * The ONE delete path. The record screen only asks (after its confirm);
   * this deletes the record and its photo-store photos, mirrors the delete
   * to the cloud when signed in, cancels push and in-tab reminders, and
   * goes back to History.
   */
  const handleDeleteRecord = (session: ParkingSession) => {
    try {
      // deleteSession also deletes the record's photos from the photo store.
      deleteSession(session.id)
    } catch (err) {
      console.warn('[storage] could not delete record:', err)
      return
    }
    // Fire-and-forget; the local delete is authoritative for this device.
    if (auth.user) {
      void deleteCloudSession(session.id).catch((err) => {
        console.warn('[sync] cloud delete failed:', err)
      })
    }
    // Stale pushes or in-tab alerts for a record the driver has thrown away
    // would be jarring. Best-effort, as on the end path.
    void cancelPushReminders(session.id)
    cancelInTabReminders(session.id)
    setView({ name: 'history' })
  }

  // OAuth federation callback splash — first paint when ?code=/?state=
  // are present, replaces what would otherwise be a brief flash of the
  // home view (marketing landing for first-time visitors, session card
  // for returning users) while the token exchange runs. Cleared in the
  // useEffect above's `finally` so callback failures don't strand here.
  if (oauthCallbackPending) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <BrandMark className="w-20 h-20 mb-5 animate-pulse" />
        <h2 className="font-display text-2xl font-extrabold text-paper-50">
          {t('auth.signingIn')}
        </h2>
      </main>
    )
  }

  if (view.name === 'scan') {
    return (
      <main className="min-h-screen">
        <SignScanner
          onCapture={handleCapture}
          onReuseSession={handleReuseSession}
          onNoSignScan={(coords, ambientPhoto, ambientPhotoMeta) =>
            setView({ name: 'logNoSign', coords, ambientPhoto, ambientPhotoMeta })
          }
          onCancel={() => setView({ name: 'home' })}
        />
      </main>
    )
  }

  if (view.name === 'logNoSign') {
    return (
      <main className="min-h-screen">
        <SessionLogger
          mode="no-sign"
          rules={null}
          signPhoto={null}
          ambientPhoto={view.ambientPhoto}
          ambientPhotoMeta={view.ambientPhotoMeta}
          coords={view.coords}
          // The no-sign path has no scan views to carry a draft, so its
          // arrival_context starts from an empty one.
          onComplete={(session) => void handleSessionSaved(session, emptyLogDraft())}
          onCancel={() => setView({ name: 'home' })}
        />
      </main>
    )
  }

  if (view.name === 'loading') {
    return <LoadingProgress />
  }

  if (view.name === 'error') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-amber-50 border-2 border-amber-400 text-amber-700 flex items-center justify-center mb-4">
          <Icon name="warning" className="w-8 h-8" />
        </div>
        <div role="alert">
          <h2 className="font-display text-2xl font-extrabold text-paper-50">
            {view.offline ? t('errors.offlineTitle') : t('errors.somethingWrong')}
          </h2>
          <p className="text-sm mt-3 mb-6 break-words" style={{ color: '#A9CFBE' }}>
            {view.offline ? t('errors.offlineBody') : view.message}
          </p>
        </div>
        <div className="flex flex-col gap-2 w-full">
          <button
            onClick={() => setView({ name: 'scan' })}
            className="bg-brand-500 hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-300 text-white font-semibold py-3 rounded-xl shadow-sm shadow-brand-900/10 transition-colors"
          >
            {t('errors.tryAgain')}
          </button>
          <button
            onClick={() => setView({ name: 'home' })}
            className="bg-white border border-paper-300 hover:border-brand-500 hover:text-brand-700 text-ink-900 font-medium py-3 rounded-xl transition-colors"
          >
            {t('errors.backHome')}
          </button>
        </div>
      </main>
    )
  }

  if (view.name === 'clarify') {
    return (
      <main className="min-h-screen">
        <Clarify
          signPhoto={view.signPhoto}
          clarification={view.result.clarification!}
          onPick={(variant) =>
            handlePickVariant(variant, view.result, view.signPhoto, view.signPhotoMeta, view.coords, view.draft)
          }
          onCancel={() => setView({ name: 'home' })}
        />
      </main>
    )
  }

  if (view.name === 'result') {
    return (
      <main className="min-h-screen">
        <ParkingResult
          result={view.result}
          signPhoto={view.signPhoto}
          coords={view.coords}
          onScanAnother={() => setView({ name: 'scan' })}
          onLogSession={() =>
            setView({
              name: 'logging',
              result: view.result,
              signPhoto: view.signPhoto,
              signPhotoMeta: view.signPhotoMeta,
              coords: view.coords,
              draft: view.draft,
            })
          }
          onRetake={() => setView({ name: 'scan' })}
          isFirstSave={loadSessions().length === 0}
        />
      </main>
    )
  }

  if (view.name === 'logging') {
    return (
      <main className="min-h-screen">
        <SessionLogger
          rules={view.result}
          signPhoto={view.signPhoto}
          signPhotoMeta={view.signPhotoMeta}
          onComplete={(session) => void handleSessionSaved(session, view.draft)}
          onCancel={() =>
            setView({
              name: 'result',
              result: view.result,
              signPhoto: view.signPhoto,
              signPhotoMeta: view.signPhotoMeta,
              coords: view.coords,
              draft: view.draft,
            })
          }
        />
      </main>
    )
  }

  if (view.name === 'remind') {
    return (
      <main className="min-h-screen">
        <ReminderOptions session={view.session} onDone={() => setView({ name: 'home' })} />
        {/* Save-time notice (quota recovery / photo-sync failure) lands here —
            the reminder screen is the view shown immediately after save. */}
        <Toast message={notice} onClose={() => setNotice(null)} />
      </main>
    )
  }

  if (view.name === 'history') {
    return (
      <main className="min-h-screen">
        <SessionHistory
          onBack={() => setView({ name: 'home' })}
          onOpen={(session) => setView({ name: 'session', session })}
        />
      </main>
    )
  }

  if (view.name === 'actives') {
    // The home-screen "+N more" affordance lands here when the user has more
    // than one active parking session simultaneously (e.g. parked two cars
    // back-to-back). Lists every active session, soonest-expiring first.
    return (
      <main className="min-h-screen">
        <ActiveSessionsList
          sessions={activeSessions}
          onBack={() => setView({ name: 'home' })}
          onOpen={(session) => setView({ name: 'session', session })}
        />
      </main>
    )
  }

  if (view.name === 'session') {
    return (
      <main className="min-h-screen">
        <SessionDetail
          session={view.session}
          onBack={() => setView({ name: 'history' })}
          onDelete={handleDeleteRecord}
          // Hand the appeal flow the stored copy, which may have gained a
          // signature or an end time since this view opened.
          onDraftAppeal={() =>
            setView({ name: 'appeal', session: getSession(view.session.id) ?? view.session })
          }
          // SessionDetail re-reads its record on the records-changed event,
          // so the "Ended ..." row shows without patching the view here.
          onEndSession={(s) => openDepartureSheet(s, 'session.endConfirm')}
        />
        {departureSheetView}
        {/* Background writes (the departure after I've left) can free
            space while this screen is open. */}
        <Toast message={notice} onClose={() => setNotice(null)} />
      </main>
    )
  }

  if (view.name === 'appeal') {
    const returnTo = view.returnTo
    return (
      <main className="min-h-screen">
        <AppealFlow
          session={view.session}
          initialNotice={view.notice ?? null}
          backLabelKey={returnTo ? 'common.back' : undefined}
          onBack={() =>
            setView(
              returnTo
                ? { name: 'notice', snapshot: returnTo }
                : view.session
                  ? { name: 'session', session: view.session }
                  : { name: 'home' },
            )
          }
        />
      </main>
    )
  }

  if (view.name === 'notice') {
    return (
      <main className="min-h-screen">
        <NoticeLookup
          initial={view.snapshot}
          onBack={() => setView({ name: 'home' })}
          // The appeal flow gets the stored copy of the record (it may have
          // gained a signature since the matches were drawn) and the notice
          // photo, so it drafts at once instead of asking for the photo again.
          onDraftAppeal={(session, snapshot) =>
            setView({
              name: 'appeal',
              session: session ? (getSession(session.id) ?? session) : null,
              notice: snapshot.photo,
              returnTo: snapshot,
            })
          }
        />
      </main>
    )
  }

  if (view.name === 'signin') {
    return (
      <main className="min-h-screen">
        <AuthFlow
          onDone={() => setView({ name: 'home' })}
          onCancel={() => setView({ name: 'home' })}
        />
      </main>
    )
  }

  if (view.name === 'settings') {
    return (
      <main className="min-h-screen">
        <AuthSettings
          onBack={() => setView({ name: 'home' })}
          onOpenPrivacy={() => setView({ name: 'privacy' })}
          onDeleted={() => setView({ name: 'home' })}
        />
      </main>
    )
  }

  if (view.name === 'privacy') {
    return (
      <main className="min-h-screen">
        <PrivacyPolicy onBack={() => setView({ name: 'home' })} />
      </main>
    )
  }

  if (view.name === 'about') {
    return (
      <main className="min-h-screen">
        <AboutFeatures
          onBack={() => setView({ name: 'home' })}
          onTryIt={() => setView({ name: 'scan' })}
        />
      </main>
    )
  }

  // The useNow tick at the top of the function drives:
  //  (a) the active-session card's countdown stays live without manual refresh
  //  (b) when an active session crosses its expiry, it falls out of the
  //      filter and the card disappears on the next tick
  const sessionCount = loadSessions().length
  const primaryActive = activeSessions[0]

  return (
    <main
      className="min-h-screen flex flex-col relative bg-brand-800 text-paper-50"
      style={{
        backgroundImage:
          'repeating-linear-gradient(115deg, rgba(123,227,164,0.055) 0 1px, transparent 1px 8px)',
      }}
    >
      <header className="px-6 pt-6 pb-2 text-center">
        {/* First-time visitors get LandingFeatures with its own hero block,
            so skip the default "ParkProof + hero illustration + tagline"
            header — otherwise the page reads as two stacked heroes. */}
        {!primaryActive && sessionCount === 0 ? (
          <div className="flex justify-end">
            <LanguageSelector />
          </div>
        ) : primaryActive ? (
          // Replace the decorative hero with the live status when there's an
          // active session — it's the most useful information on the screen
          // at that moment, and competes for the same visual real estate.
          <div className="flex items-center justify-center gap-2.5">
            <BrandMark variant="glyph" tone="paper" className="w-8 h-8" />
            <h1 className="font-display text-3xl font-extrabold text-paper-50 tracking-tight">
              ParkProof
            </h1>
          </div>
        ) : (
          <>
            <img
              // import.meta.env.BASE_URL is set by Vite's `base` config (now
              // '/app/' post-cutover). Using it instead of a literal "/foo"
              // means the path follows wherever the app is mounted — works
              // in dev, prod under /app/, or any future base.
              src={`${import.meta.env.BASE_URL}hero-illustration.png`}
              alt=""
              className="w-full max-w-[360px] mx-auto mb-2 select-none pointer-events-none"
              aria-hidden
            />
            <div className="flex items-center justify-center gap-2.5">
              <BrandMark variant="glyph" tone="paper" className="w-9 h-9" />
              <h1 className="font-display text-4xl font-extrabold text-paper-50 tracking-tight">
                ParkProof
              </h1>
            </div>
            <p className="text-sm mt-2 max-w-[20rem] mx-auto leading-relaxed" style={{ color: '#A9CFBE' }}>
              {t('home.tagline')}
            </p>
          </>
        )}
        {/* Language selector — for the active-session and returning-user
            paths, centred under the hero header. First-time visitors get
            theirs rendered in the right-aligned strip above (see the
            sessionCount === 0 branch at the top of the header). */}
        {!(!primaryActive && sessionCount === 0) && (
          <div className="mt-4">
            <LanguageSelector />
          </div>
        )}
      </header>

      <section className="flex-1 px-6 pb-8 flex flex-col items-center justify-center max-w-md mx-auto w-full">
        {syncError && (
          <div className="w-full mb-4 bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-sm text-amber-900 leading-snug">{t('errors.syncFailed')}</span>
            <button
              onClick={() => {
                setSyncError(false)
                runInitialSync()
              }}
              className="text-sm font-semibold text-brand-700 hover:text-brand-800 underline shrink-0"
            >
              {t('common.retry')}
            </button>
          </div>
        )}
        {primaryActive && (
          <div className="w-full mb-6">
            <ActiveSessionCard
              session={primaryActive}
              extraCount={activeSessions.length - 1}
              onOpen={(s) => setView({ name: 'session', session: s })}
              onShowMore={() => setView({ name: 'actives' })}
              onEndSession={(s) => openDepartureSheet(s, 'active.iveLeftConfirm')}
              onRecheck={handleReuseSession}
            />
          </div>
        )}

        {/* Landing experience — first-time visitors only.
            Conditional on (no active session) AND (no saved sessions).
            This component owns the full hero (split-colour headline,
            three value bullets, gradient CTA, How-it-works, evidence
            callout). It includes its own scan-button CTA, so we DON'T
            render the standard scan button below for first-time visitors. */}
        {!primaryActive && sessionCount === 0 ? (
          <LandingFeatures
            onScanCta={() => setView({ name: 'scan' })}
            // Only pass the sign-in handler when Cognito is wired in AND
            // the user isn't already signed in. LandingFeatures renders
            // the secondary CTA conditionally on this prop being defined,
            // so the returning-user-on-a-new-device cohort can reach the
            // sign-in screen directly from the first-time-visitor surface.
            // First moved this to a bottom-of-screen underlined link in
            // the previous commit, then realised the bottom of the scroll
            // is where things go to die. Hoisting it next to the primary
            // CTA so it's actually discoverable.
            onSignInCta={
              auth.configured && !auth.user
                ? () => setView({ name: 'signin' })
                : undefined
            }
          />
        ) : (
          <>
            <button
              id={HOME_SCAN_ID}
              onClick={() => setView({ name: 'scan' })}
              className="w-full bg-paper-50 hover:bg-white active:bg-paper-100 text-brand-800 text-lg font-semibold py-4 rounded-xl gf-btn flex items-center justify-center gap-3 transition-colors"
            >
              <Icon name="camera" className="w-6 h-6" />
              {primaryActive ? t('home.scanAnother') : t('home.scanCta')}
            </button>

            {!primaryActive && (
              <p className="text-xs mt-4 text-center" style={{ color: '#A9CFBE' }}>
                {t('home.scanHelp')}
              </p>
            )}
          </>
        )}

        {/* Long translations (Italian / Hindi / Punjabi) wrap to two lines.
            Use items-start + flex-1 min-w-0 so the icon anchors to the first
            line and the right-side label sits flush with it, instead of all
            three drifting to the vertical centre of the 2-line text block. */}
        {/* Session-history affordance — hidden for first-time visitors
            (sessionCount === 0 AND no active session): the empty "Session
            history (empty)" row is just clutter under the new LandingFeatures
            and competes for visual attention with the gradient CTA above. */}
        {!(sessionCount === 0 && !primaryActive) && (
          <button
            onClick={() => setView({ name: 'history' })}
            className="gf-card mt-8 w-full text-paper-50 font-medium py-3 flex items-start justify-between gap-3 px-5 transition-colors hover:brightness-110"
            style={{ background: 'rgba(255,255,255,0.055)' }}
          >
            <span className="flex items-start gap-2 min-w-0 flex-1">
              <Icon name="list" className="w-5 h-5 shrink-0 mt-px text-[#A9CFBE]" />
              <span className="leading-snug text-left">{t('home.history')}</span>
            </span>
            <span className="text-sm shrink-0 mt-px pr-2" style={{ color: '#A9CFBE' }}>
              {sessionCount === 0 ? t('home.historyEmpty') : t('home.historyCount', { count: sessionCount })}
            </span>
          </button>
        )}

        {/* Auth affordance — only renders when Cognito is wired in AND the
            user isn't a brand-new visitor. Anonymous returning users see a
            "Sign in to sync" CTA; signed-in users see their email + a cog
            icon that opens settings. Hidden for first-time visitors so the
            new landing's gradient CTA owns the primary action. */}
        {auth.configured && !(sessionCount === 0 && !primaryActive) && (
          auth.user ? (
            <button
              onClick={() => setView({ name: 'settings' })}
              className="gf-card mt-2 w-full text-paper-50 font-medium py-3 flex items-start justify-between gap-3 px-5 transition-colors hover:brightness-110"
              style={{ background: 'rgba(255,255,255,0.055)' }}
            >
              <span className="flex items-start gap-2 min-w-0 flex-1">
                <Icon name="check" className="w-5 h-5 text-[#7BE3A4] shrink-0 mt-px" strokeWidth={2.5} />
                <span className="truncate">{auth.user.email}</span>
              </span>
              <span className="text-xs shrink-0 mt-1 pr-2" style={{ color: '#A9CFBE' }}>{t('home.account')}</span>
            </button>
          ) : (
            <button
              onClick={() => setView({ name: 'signin' })}
              className="gf-card mt-2 w-full text-paper-50 font-medium py-3 flex items-start justify-between gap-3 px-5 transition-colors hover:brightness-110"
              style={{ background: 'rgba(255,255,255,0.055)' }}
            >
              <span className="flex items-start gap-2 min-w-0 flex-1">
                <Icon name="bell" className="w-5 h-5 shrink-0 mt-px text-[#A9CFBE]" />
                <span className="leading-snug text-left">{t('home.signInToSync')}</span>
              </span>
              <span className="text-xs shrink-0 mt-1 pr-2" style={{ color: '#A9CFBE' }}>{t('common.optional')}</span>
            </button>
          )
        )}

        {/* The 3-step "Photo the sign → log → reminder" list. Shown to
            returning users with no active session as a quick re-orientation,
            but hidden for first-time visitors — LandingFeatures' "How it
            works" grid already covers the same ground with better visuals. */}
        {!primaryActive && sessionCount > 0 && (
          <ol className="mt-10 space-y-4 self-stretch">
            {[
              t('home.steps.translate'),
              t('home.steps.log'),
              t('home.steps.remind'),
            ].map((text, i) => (
              <li key={i} className="flex gap-4 items-start">
                <span className="font-display text-2xl font-extrabold text-[#7BE3A4] leading-none w-7 text-center shrink-0">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed pt-1" style={{ color: '#A9CFBE' }}>{text}</span>
              </li>
            ))}
          </ol>
        )}

        {/* "Got a fine? Start here" (build spec T8): the notice lookup. The
            smallest entry point until T4's home layout gives it its own row. */}
        <button
          onClick={() => setView({ name: 'notice', snapshot: null })}
          className="mt-8 text-sm text-[#7BE3A4] hover:text-paper-50 font-medium underline self-center min-h-[44px] inline-flex items-center py-2.5"
        >
          {t('notice.homeLink')}
        </button>

        {/* Standalone appeal entry — reachable for the highest-intent user:
            someone who got a ticket and found ParkProof to fight it, but never
            logged a park here. Routes into AppealFlow with no linked session;
            the flow drafts from the infringement notice alone. */}
        <button
          onClick={() => setView({ name: 'appeal', session: null })}
          className="mt-2 text-sm text-[#7BE3A4] hover:text-paper-50 font-medium underline self-center min-h-[44px] inline-flex items-center py-2.5"
        >
          {t('home.draftAppeal')}
        </button>

        <div className="mt-6 flex items-center justify-center gap-6 self-center flex-wrap">
          <button
            onClick={() => setView({ name: 'about' })}
            className="text-xs hover:text-paper-50 underline min-h-[44px] inline-flex items-center -my-2.5"
            style={{ color: '#A9CFBE' }}
          >
            {t('common.about')}
          </button>
          <button
            onClick={() => setView({ name: 'privacy' })}
            className="text-xs hover:text-paper-50 underline min-h-[44px] inline-flex items-center -my-2.5"
            style={{ color: '#A9CFBE' }}
          >
            {t('common.privacy')}
          </button>
          <button
            onClick={() => setFeedbackOpen(true)}
            className="text-xs hover:text-paper-50 underline min-h-[44px] inline-flex items-center -my-2.5"
            style={{ color: '#A9CFBE' }}
          >
            {t('common.sendFeedback')}
          </button>
        </div>
      </section>

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        context={{
          page: 'home',
          app_version: import.meta.env.VITE_APP_VERSION as string | undefined,
          sessions_count: sessionCount,
          is_signed_in: !!auth.user,
        }}
      />
      {departureSheetView}
      <Toast message={notice} onClose={() => setNotice(null)} />
    </main>
  )
}

export default App
