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
import Settings from './components/Settings'
import PrivacyPolicy from './components/PrivacyPolicy'
import FeedbackModal from './components/FeedbackModal'
import DepartureSheet, { type DepartureConfirmation } from './components/DepartureSheet'
import BackupPrompt from './components/BackupPrompt'
import LandingFeatures from './components/LandingFeatures'
import AboutFeatures from './components/AboutFeatures'
import LanguageSelector from './components/LanguageSelector'
import BrandMark from './components/BrandMark'
import Icon from './components/Icon'
import LoadingProgress from './components/LoadingProgress'
import NoReadableSign from './components/NoReadableSign'
import RecurringReminders from './components/RecurringReminders'
import HomeMenu from './components/HomeMenu'
import ShareSheet from './components/ShareSheet'
import SharedLinkView from './components/SharedLinkView'
import SharedRecordScreen from './components/SharedRecordScreen'
import WorkdayStart, { type WorkdayStartInput } from './components/WorkdayStart'
import WorkdayCard from './components/WorkdayCard'
import WorkdayView from './components/WorkdayView'
import WorkdayEndDialog from './components/WorkdayEndDialog'
import { refreshInterpretation, translateSign } from './lib/claude'
import {
  deleteSession,
  endSession,
  endWorkday,
  getActiveWorkday,
  getSession,
  loadWorkdays,
  markWorkdayMoving,
  setWorkdayLeg,
  startWorkday,
  isDuplicateRecordError,
  isStorageFullError,
  loadActiveSessions,
  loadProfile,
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
import { useRecurringInTabReminders, useRecurringRules } from './lib/use-recurring-rules'
import { recurringHomeCount, recurringHomeNext } from './lib/recurring-copy'
import { useRecurringPushSync } from './lib/use-recurring-push'
import {
  holdAddendumSigning,
  installSigningTriggers,
  permitCommitmentFor,
  prepareNewRecord,
  releaseAddendumSigning,
  runSigningSweep,
  scheduleDepartureCatchUp,
  setSignedRecordListener,
  signNewRecord,
} from './lib/signing'
import { applyLogDraftDefaults } from './lib/evidence-chain'
import { logDraftFromProfile, signReaderExtras, usablePermits } from './lib/profile'
import { withResultAnswers } from './lib/permit-answer'
import { parkingStateForCoords, parkingStateForRecord } from './lib/parking-state'
import {
  applyRefreshOverride,
  mergeChosenVariant,
  noSignReadingOf,
  refreshPriorOf,
  viewForReading,
  type NoSignReading,
  type ReadingView,
} from './lib/sign-result'
import { completeDeparture, requestDepartureFix, settleReturnPhotos, type DepartureFixRequest } from './lib/departure'
import { HOME_SCAN_ID, RECORD_STATUS_ID, WORKDAY_SCAN_ID, firstFocusTarget } from './lib/focus-targets'
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
import { isWorkdayEnabled } from './lib/features'
import {
  firstStopOffer,
  isFirstWorkday,
  resolveLegSave,
  showStartWorkdayLink,
  workdayHome,
  workdayLegDraft,
  type LegSaveDecision,
  type WorkdayHome,
} from './lib/workday-flow'
import { useWorkdayReadiness } from './lib/use-workday-readiness'
import { stopContext, stopLimitFields, withoutStopLimit } from './lib/workday-boundary'
import { bookWorkdayLegReminders, rearmWorkdayLegInTab } from './lib/workday-reminders'
import { workdayLegs } from './lib/workday'
import type { RemindMeSummary } from './lib/remind-me'
import type { CapturedNotice, NoticeSnapshot } from './lib/notice-read'
import type { LogDraft, ParkingRules, ParkingSession, RuleVariant } from './types'

type Coords = { lat: number; lng: number } | null

/** Why a workday scan's park ended the workday, when the driver is told. */
type WorkdayStopReason = 'jurisdiction' | 'unknown_state'

/** The notice the reminder screen shows for each reason. */
const WORKDAY_STOPPED_KEYS: Record<WorkdayStopReason, string> = {
  jurisdiction: 'workday.stopped.notAvailable',
  unknown_state: 'workday.stopped.unknownState',
}

/** A workday view to open: its workday, and where its Back goes. */
interface WorkdayViewTarget {
  workdayId: string
  back: 'home' | 'history'
}

interface ScanView<N extends 'clarify' | 'result' | 'logging' | 'noReadableSign'> {
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
   * T3: the sign reader found no readable parking sign in the photo
   * ('missing' or 'not_a_parking_sign'). No answer is shown; the driver
   * retakes the photo or logs the park without a sign.
   */
  | ScanView<'noReadableSign'>
  /**
   * "No sign here" flow — user parked at a spot with no signage and wants a
   * GPS + time evidence record without the AI translation. The ambient photo
   * (optional, opt-in) demonstrates absence of signs.
   *
   * `unread` (T3) is set when the driver came from the "no readable sign"
   * screen: the scan photo is the surroundings photo, the record keeps the
   * status ParkProof found, and Cancel goes back to that screen.
   */
  | {
      name: 'logNoSign'
      coords: Coords
      ambientPhoto: string | null
      ambientPhotoMeta: PhotoCaptureMeta | null
      unread?: { reading: NoSignReading; back: ScanView<'noReadableSign'> }
    }
  /**
   * `workdayStopped` (T6b item 7): a workday scan's park wasn't in
   * Victoria or Queensland ('jurisdiction'), or its state couldn't be told
   * ('unknown_state'), so it was saved as a normal record and the workday
   * stopped. The reminder screen says which.
   */
  | { name: 'remind'; session: ParkingSession; workdayStopped?: WorkdayStopReason }
  | { name: 'history' }
  | { name: 'actives' }
  /** `returnTo`: the workday view this stop was opened from (T6b), for Back. */
  | { name: 'session'; session: ParkingSession; returnTo?: WorkdayViewTarget }
  /**
   * Workday mode (T6b, behind VITE_FEATURE_WORKDAY): the start screen (the
   * location gate, readiness and the explainer), and one workday's stops.
   */
  | { name: 'workdayStart' }
  | ({ name: 'workday' } & WorkdayViewTarget)
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
  /**
   * Settings (T4): the driver's name, saved permits and notifications.
   * Works without an account and links to Account when signed in.
   */
  | { name: 'settings' }
  /** Account (AuthSettings): cloud sync, export, sign out, delete. Signed in only. */
  | { name: 'account' }
  /** `back`: the screen the policy was opened from, when not home. */
  | { name: 'privacy'; back?: 'settings' | 'account' }
  | { name: 'about' }
  /** Street sweeping and weekly reminders: the list and its editor (T5a). */
  | { name: 'recurring' }
  /**
   * A share link opened on this device (T7): `token` is the text after
   * `#share=`, read at startup (or on hashchange) and already cleared from
   * the address bar.
   */
  | { name: 'shared'; token: string }
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
  /**
   * Opened by the workday card (T6b): "I'm moving the car now" ('move')
   * or "End workday" with the car still at the stop ('end'). Confirm then
   * also moves the workday between moves, or ends it.
   */
  workday?: { id: string; action: 'move' | 'end' }
}

/** The scan view an answer goes to (viewForReading), carrying the scan's photo, place and draft. */
function scanViewFor(name: ReadingView, fields: Omit<ScanView<'result'>, 'name'>): View {
  switch (name) {
    case 'noReadableSign':
      return { name, ...fields }
    case 'clarify':
      return { name, ...fields }
    default:
      return { name: 'result', ...fields }
  }
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

/**
 * Views a share link opened in an already open tab may replace at once
 * (T7). Every other view is mid-flow (a scan being read, the logger with
 * unsaved photos, a form being filled in): there the link waits, and opens
 * when the driver is back on one of these.
 */
const SHARE_SAFE_VIEWS: ReadonlySet<View['name']> = new Set<View['name']>([
  'home',
  'history',
  'actives',
  'session',
  'workday',
  'shared',
  'privacy',
  'about',
  'error',
])

function App() {
  // Deep link from a reminder notification (?session=), the landing footer
  // (?privacy=open, ?feedback=open) or a share link (#share=, T7). Read once,
  // at first render, so the first paint is the right screen; the effect
  // below then cleans the URL.
  const [initialLink] = useState(() =>
    typeof window === 'undefined' ? null : parseDeepLink(window.location.search, window.location.hash),
  )
  const [view, setView] = useState<View>(() => {
    if (initialLink?.kind === 'share') return { name: 'shared', token: initialLink.token }
    if (initialLink?.kind === 'session') {
      const linked = loadSessions().find((s) => s.id === initialLink.sessionId)
      if (linked) return { name: 'session', session: linked }
    }
    if (initialLink?.kind === 'privacy') return { name: 'privacy' }
    if (initialLink?.kind === 'recurring') return { name: 'recurring' }
    return { name: 'home' }
  })
  const [feedbackOpen, setFeedbackOpen] = useState(() => initialLink?.kind === 'feedback')
  useEffect(() => {
    if (initialLink) clearDeepLinkParams()
  }, [initialLink])
  // "Share where the car is" from the home card's Share icon (T7): the
  // record whose share sheet is open.
  const [shareSheet, setShareSheet] = useState<ParkingSession | null>(null)
  // A share link opened in a tab where the app is already open only changes
  // the fragment (no reload), so it is picked up here too. It waits here
  // until the driver is somewhere it can replace (see SHARE_SAFE_VIEWS).
  const [pendingShare, setPendingShare] = useState<string | null>(null)
  useEffect(() => {
    const onHashChange = () => {
      const link = parseDeepLink('', window.location.hash)
      if (link?.kind !== 'share') return
      clearDeepLinkParams()
      setPendingShare(link.token)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  // Transient save-time notice (quota recovery, photo-sync failure). Auto-clears.
  const [notice, setNotice] = useState<string | null>(null)
  // The "I've left" departure sheet, open over home or the record screen.
  const [departureSheet, setDepartureSheet] = useState<DepartureSheetState | null>(null)
  // A sheet the record screen opened itself (the add-photo sheets). The
  // backup prompt waits while it is open: one dialog at a time.
  const [recordSheetOpen, setRecordSheetOpen] = useState(false)
  // Open a waiting share link once nothing would be lost by leaving: a
  // scan in flight, the logger's unsaved photos, a form or an open sheet
  // keep it waiting until the driver is back on a view it can replace.
  // Adjusting state during render (not in an effect), so the shared view
  // is the next paint.
  const shareCanOpen = SHARE_SAFE_VIEWS.has(view.name) && !departureSheet && !recordSheetOpen && !feedbackOpen
  if (pendingShare && shareCanOpen) {
    setPendingShare(null)
    setShareSheet(null)
    setView({ name: 'shared', token: pendingShare })
  }
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
  // Workday mode (T6b), only with VITE_FEATURE_WORKDAY on. The active
  // workday is re-read on every records change (the workday store's writes
  // fire it too). While it is between moves, every scan is the next stop's:
  // a fresh photo only, its stop's draft, and Back goes home. The card
  // offers the calendar file when reminders can't reach the driver.
  const workdayOn = isWorkdayEnabled()
  const activeWorkday = useMemo(
    () => (workdayOn ? getActiveWorkday() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workdayOn, activesVersion],
  )
  const workdayScan = activeWorkday?.status === 'between_moves'
  const [workdayReadiness, refreshWorkdayReadiness] = useWorkdayReadiness()
  // "End this workday?" while it is open: the id of the workday it ends.
  const [workdayEndId, setWorkdayEndId] = useState<string | null>(null)
  // What setting a stop's reminders did in this page (T6b item 9), for the
  // workday card: they are set when the stop is saved, with no reminder
  // screen. `booking` while it runs (the card says nothing yet). No entry:
  // not tried here (the card then reads the booked times from the record).
  const [stopReminders, setStopReminders] = useState<{
    legId: string
    summary?: RemindMeSummary | null
    booking: boolean
  } | null>(null)
  // In-tab reminders don't survive a reload: arm the parked stop's again
  // (in-tab only, once per page, never asking for permission).
  const parkedStopId = activeWorkday?.status === 'parked' ? activeWorkday.current_session_id : null
  useEffect(() => {
    if (!parkedStopId || !isWorkdayEnabled()) return
    const leg = getSession(parkedStopId)
    if (!leg || typeof leg.workday_id !== 'string') return
    rearmWorkdayLegInTab(leg, workdayLegs(loadSessions(), leg.workday_id), t)
  }, [parkedStopId, t])

  // Weekly reminders (T5a): the home row reads them, and while the app is
  // open their next 24 hours of reminders stay armed in this tab. T5b keeps
  // the server's push schedules for them in step, for when the app is closed.
  const recurringRules = useRecurringRules()
  useRecurringInTabReminders(recurringRules)
  useRecurringPushSync(recurringRules)

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
    // Between workday moves the next stop needs a photo taken now (T6b
    // item 6). The scanner refuses an old one and says why; this is the
    // backstop: such a photo never becomes a stop, and the driver goes back
    // to the camera.
    if (signPhotoMeta.source === 'library' && isWorkdayEnabled() && getActiveWorkday()?.status === 'between_moves') {
      setView({ name: 'scan' })
      return
    }
    setView({ name: 'loading' })
    try {
      const base64 = stripDataUrlPrefix(dataUrl)
      // The driver's saved permits (type, and the area of a resident or
      // business permit) and the state the car is parked in, when the
      // coordinates place it without doubt (T4 item 3).
      const profile = loadProfile()
      const result = await translateSign(base64, mediaType, coords, signReaderExtras(profile, parkingStateForCoords(coords)))
      // The new record's driver defaults to the name saved in Settings. A
      // scan while a workday is between moves is its next stop (T6b item 6):
      // the draft carries the workday link, read now, not at render.
      const profileDraft = logDraftFromProfile(profile)
      const legDraft = isWorkdayEnabled() ? workdayLegDraft(getActiveWorkday(), loadSessions()) : null
      const draft: LogDraft = legDraft ? { ...profileDraft, workday: legDraft } : profileDraft
      // 'missing' and 'not_a_parking_sign' have no answer to show (T3).
      setView(scanViewFor(viewForReading(result), { result, signPhoto: dataUrl, signPhotoMeta, coords, draft }))
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
    // The picked position's rules, answer and per-position flags (permit
    // gates, and from T3 the area flag and permit exception) replace the
    // whole sign's; see mergeChosenVariant.
    const merged = mergeChosenVariant(base, variant)
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
    // Workday legs are never re-checked, and nothing is while a workday is
    // active (T6b items 4 to 6): between moves a stop needs a fresh photo of
    // its new sign, and at a stop a re-check would give a car that hasn't
    // moved a second arrival. The scanner and the home card hide every way
    // in; this is the backstop. A leg is refused whatever the flag says
    // (such records only exist where it was on).
    if (typeof session.workday_id === 'string' && session.workday_id !== '') {
      openScan()
      return
    }
    if (isWorkdayEnabled() && getActiveWorkday()) {
      openScan()
      return
    }
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
      // The earlier reading, with what it saw in the photo (T3: the sign's
      // condition and the area flag), which the server echoes back, and the
      // driver's saved permits and the record's state (T4 item 3).
      const profile = loadProfile()
      const fresh = await refreshInterpretation(
        refreshPriorOf(session),
        session.location,
        signReaderExtras(profile, parkingStateForRecord(session)),
      )
      // Trust the model only for current-time fields. Everything else is the
      // user-verified prior reading — we don't want the model to "re-creatively"
      // change observations, rules text, the chosen variant, or what the
      // photo showed (sign condition, area flag, weekly restrictions).
      const result: ParkingRules = {
        ...applyRefreshOverride(fresh, session),
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
      setView(
        scanViewFor(viewForReading(result), {
          result,
          signPhoto,
          signPhotoMeta,
          coords: reusedCoords,
          draft: logDraftFromProfile(profile),
        }),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setView({ name: 'error', message, offline: isOffline() })
    }
  }

  /**
   * What a logged record becomes when it came from a workday scan (T6b
   * item 7): the next stop (its workday id and leg index on the record and
   * in the draft, so link 1 signs the workday link), or a normal record
   * with no workday link when it can't be a stop. Anything else passes
   * through unchanged.
   */
  const workdayLegFor = (
    logged: ParkingSession,
    draft: LogDraft,
  ): { record: ParkingSession; draft: LogDraft; decision: LegSaveDecision } => {
    const decision: LegSaveDecision = isWorkdayEnabled()
      ? resolveLegSave(logged, draft, getActiveWorkday(), loadSessions())
      : { kind: 'normal' }
    if (decision.kind === 'leg') {
      // Its limit (T6b item 8): its own sign's, or, when the driver didn't
      // name a boundary, the stretch's still running, from the logger's
      // boundary statement and the workday's saved legs.
      const limit = stopLimitFields(logged, stopContext(loadSessions(), decision.workday.workday_id))
      return {
        record: { ...logged, workday_id: decision.workday.workday_id, leg_index: decision.workday.leg_index, ...limit },
        draft: { ...draft, workday: decision.workday },
        decision,
      }
    }
    const normalDraft = draft.workday ? { ...draft, workday: null } : draft
    if (
      decision.kind === 'stop' &&
      draft.workday &&
      (decision.reason === 'unknown_state' || decision.reason === 'full')
    ) {
      // Not a stop, but not known to be anywhere else either (its state
      // couldn't be told), or past the most stops a workday holds. The car
      // may not have left the stretch, so fail safe: keep the limit the
      // logger showed (the running one after "I'm not sure", never a fresh
      // one), and the driver's boundary statement, which link 1 signs.
      const limit = stopLimitFields(logged, stopContext(loadSessions(), draft.workday.workday_id))
      return { record: { ...logged, ...limit }, draft: normalDraft, decision }
    }
    // Not a stop after all: a normal record with its own sign reading.
    return { record: withoutStopLimit(logged), draft: normalDraft, decision }
  }

  /**
   * Set a workday stop's reminders (T6b item 9): T6a's schedule, in-tab and
   * push, with no reminder screen. The workday card shows what was set.
   * From "Retry" (`fromTap`) the browser may ask for permission.
   */
  const setStopRemindersFor = async (legId: string, fromTap = false) => {
    if (!isWorkdayEnabled()) return
    const leg = getSession(legId)
    if (!leg || typeof leg.workday_id !== 'string') return
    setStopReminders({ legId, booking: true })
    const summary = await bookWorkdayLegReminders(leg, workdayLegs(loadSessions(), leg.workday_id), t, {
      fromTap,
      signedIn: Boolean(auth.user),
    })
    setStopReminders({ legId, summary, booking: false })
    // A tap may have just allowed notifications: the card reads them again.
    if (fromTap) refreshWorkdayReadiness()
  }

  /**
   * After a workday scan's record is saved: a stop becomes the workday's
   * current stop (the workday is parked again); a park that couldn't be a
   * stop ends the workday. Returns 'leg'; the reason the driver must be
   * told ('jurisdiction': not in Victoria or Queensland; 'unknown_state':
   * the state couldn't be told); or null.
   */
  const settleWorkdayAfterSave = (decision: LegSaveDecision, sessionId: string): 'leg' | WorkdayStopReason | null => {
    try {
      if (decision.kind === 'leg') {
        setWorkdayLeg(decision.workday.workday_id, sessionId)
        return 'leg'
      }
      if (decision.kind === 'stop' && decision.workday_id) {
        endWorkday(decision.workday_id)
        return decision.reason === 'jurisdiction' || decision.reason === 'unknown_state' ? decision.reason : null
      }
    } catch (err) {
      console.warn('[workday] could not update the workday after a save:', err)
    }
    return null
  }

  const handleSessionSaved = async (logged: ParkingSession, loggedDraft: LogDraft) => {
    // A workday scan's park is the next stop, or a normal record (T6b).
    const leg = workdayLegFor(logged, loggedDraft)
    const draft = leg.draft
    // The record's chain key and link-0 photo hashes are set at save, so
    // link 0 can always be signed later even if the photos are gone. Never
    // throws; without hashes, link 0 hashes the photos when it signs.
    // A record that doesn't say who was driving takes the draft's driver
    // (the name saved in Settings, T4 item 7), which link 1 then signs.
    // The draft also brings the result screen's gate answers and the permit
    // the driver confirmed (T4 items 4 to 6); prepareNewRecord gives a
    // permit its salt.
    const session = await prepareNewRecord(applyLogDraftDefaults(leg.record, draft))
    // N3: link 1 signs only a commitment to the permit details, never the
    // details. Worked out before the save, so nothing waits between the
    // save and queueing link 1. Null when no permit was used.
    const permitCommitment = await permitCommitmentFor(session)
    try {
      // If quota recovery had to strip or evict older records to fit, the
      // storage-recovered listener above tells the driver. We don't block
      // them: they get straight to the reminder screen, where the notice
      // shows, and History reflects the cleanup on next render.
      saveSession(session)
      // A workday stop goes back home, to the workday card (T6b). Its
      // reminders are workday mode's own (T6b item 9 schedules them here),
      // not the reminder screen's. A park that ended the workday goes on to
      // the reminder screen as a normal record, saying why when it has to.
      const workdayOutcome = settleWorkdayAfterSave(leg.decision, session.id)
      if (workdayOutcome === 'leg') void setStopRemindersFor(session.id)
      // No-sign sessions skip the reminder step — there's no expiry to remind
      // about. They go straight back to the home screen, where the saved
      // session is visible in History.
      // No-sign sessions used to skip ReminderOptions because the picker
      // only knew about "X min before expiry" and there's no expiry on a
      // no-sign session. The picker now supports an open-ended "remind
      // me in N hours" mode, so route everyone through it — the driver
      // can pick "1 hour" / "4 hours" / etc. to check on their car.
      setView(
        workdayOutcome === 'leg'
          ? { name: 'home' }
          : { name: 'remind', session, workdayStopped: workdayOutcome ?? undefined },
      )
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
      signNewRecord(session.id, draft, { permit_commitment: permitCommitment })
    } catch (err) {
      // The same record saved twice (a repeated save of one logger): the
      // record IS saved, so leave it, and its photos, alone, and move on as
      // a save does, to its reminders. (Staying here would leave the driver
      // on a logger whose Save is disabled.)
      if (isDuplicateRecordError(err)) {
        console.warn('[storage] record already saved:', session.id)
        const saved = getSession(session.id)
        if (saved) setView(isWorkdayEnabled() && saved.workday_id ? { name: 'home' } : { name: 'remind', session: saved })
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
    workday?: DepartureSheetState['workday'],
  ) => {
    const current = getSession(session.id)
    if (!current || current.ended_at || departureSheet) return
    setDepartureSheet({ session: current, fix: requestDepartureFix(), confirmKey, workday })
  }

  /**
   * The workday side of a confirmed departure (T6b items 6 and 10). When
   * the record just left is the active workday's current stop, the workday
   * moves between moves ("I'm moving the car now", or I've left on the
   * stop's record screen), or ends ("End workday" with the car still at the
   * stop). Also after a tap that found the stop already ended: the driver
   * still asked to move on or end.
   */
  const settleWorkdayDeparture = (sheet: DepartureSheetState) => {
    if (!isWorkdayEnabled()) return
    try {
      const workday = getActiveWorkday()
      if (!workday || workday.current_session_id !== sheet.session.id) return
      if (sheet.workday?.action === 'end' && sheet.workday.id === workday.id) endWorkday(workday.id)
      else markWorkdayMoving(workday.id)
    } catch (err) {
      console.warn('[workday] could not record the move:', err)
    }
  }

  /**
   * "Confirm I've left": end the record now (the tap time is ended_at) and
   * close the sheet at once. In the background, wait up to 8 s for the
   * fix, then save the record's departure and queue the signed departure
   * addendum (completeDeparture). A tab closed before that is covered by
   * the departure catch-up.
   */
  const confirmDeparture = (confirmation?: DepartureConfirmation) => {
    const sheet = departureSheet
    setDepartureSheet(null)
    if (!sheet) return
    const signedIn = !!auth.user
    const onRecordUpdated = (id: string) => {
      if (signedIn) mirrorSessionUpdateToCloud(id)
    }
    const endedAt = handleEndSession(sheet.session)
    settleWorkdayDeparture(sheet)
    if (!endedAt) {
      // This tap didn't end the record (it was ended meanwhile, or is
      // gone): photos taken on the sheet are kept as return photos of an
      // ended record, or tidied away.
      void settleReturnPhotos(sheet.session.id, confirmation?.returnPhotos, onRecordUpdated)
      return
    }
    void completeDeparture(sheet.session.id, endedAt, sheet.fix, {
      // Condition photos taken on the sheet go into the departure part.
      returnPhotos: confirmation?.returnPhotos,
      onRecordUpdated,
    })
  }

  // The one-time backup prompt after the first signed photo (T2 item 12),
  // on the calm screens only (home, history, a record), never mid-flow.
  const backupPrompt = (
    <BackupPrompt
      enabled={!auth.loading}
      signedIn={!!auth.user}
      canSignIn={auth.configured}
      onSignIn={() => setView({ name: 'signin' })}
    />
  )

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
      returnFocus={() => firstFocusTarget(RECORD_STATUS_ID, WORKDAY_SCAN_ID, HOME_SCAN_ID)}
    />
  ) : null

  /**
   * "Start workday", or "Use the car's current park as the first stop", on
   * the start screen (T6b items 1 and 4). The start screen has already
   * checked the jurisdiction from the phone's location. The first stop is
   * read again here: when it can no longer be one (ended meanwhile), the
   * workday starts between moves instead. As leg 0 it is tagged on this
   * device only, never re-signed, so it keeps its arrival time and limit.
   */
  const handleStartWorkday = ({ jurisdiction, firstStopId }: WorkdayStartInput) => {
    if (!isWorkdayEnabled()) return
    if (getActiveWorkday()) {
      setView({ name: 'home' })
      return
    }
    const stored = firstStopId ? getSession(firstStopId) : undefined
    const firstStop = stored && firstStopOffer(stored).kind === 'offer' ? stored : null
    const id = crypto.randomUUID()
    let tagged = false
    try {
      if (firstStop) {
        updateSession(firstStop.id, { workday_id: id, leg_index: 0 })
        tagged = true
      }
      startWorkday({ jurisdiction, current_session_id: firstStop?.id ?? null, id })
      if (firstStop && auth.user) mirrorSessionUpdateToCloud(firstStop.id)
      // As a workday stop it gets the workday reminders (T6b item 9), in
      // place of any it had: same limit, the workday copy.
      if (firstStop) void setStopRemindersFor(firstStop.id)
      setView({ name: 'home' })
    } catch (err) {
      if (tagged && firstStop) {
        try {
          updateSession(firstStop.id, { workday_id: null, leg_index: null })
        } catch (e) {
          console.warn('[workday] could not untag the first stop:', e)
        }
      }
      console.warn('[workday] could not start the workday:', err)
      setView({
        name: 'error',
        message: isStorageFullError(err) ? t('errors.storageFull') : err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * "Parked again? Scan the new sign" (T6b item 6). When home showed the
   * move from a stop that ended elsewhere (I've left on its record screen,
   * or on another device) while the workday still said parked, the workday
   * moves between moves first, so the scan is the next stop's.
   */
  const handleWorkdayScan = () => {
    const workday = isWorkdayEnabled() ? getActiveWorkday() : null
    // Only between moves: with the car still at a live stop, a scan would
    // give a car that hasn't moved a second arrival.
    if (!workday || workdayHome(workday, loadSessions()).phase !== 'moving') return
    if (workday.status === 'parked') {
      try {
        markWorkdayMoving(workday.id)
      } catch (err) {
        console.warn('[workday] could not record the move:', err)
      }
    }
    setView({ name: 'scan' })
  }

  /**
   * Every other way into the scanner (About's "Try it", the error screen's
   * "Try again", the first-visit card). While a workday is active the
   * workday card is the only way to scan (T6b items 5 and 6): between moves
   * this is the next stop's scan; with the car still at a live stop it goes
   * home to the card, because a scan there would give a car that hasn't
   * moved a second arrival.
   */
  const openScan = () => {
    const workday = isWorkdayEnabled() ? getActiveWorkday() : null
    if (!workday) {
      setView({ name: 'scan' })
      return
    }
    if (workdayHome(workday, loadSessions()).phase === 'moving') handleWorkdayScan()
    else setView({ name: 'home' })
  }

  /**
   * "End workday" (T6b item 10). With the car still at a stop, the
   * departure flow for that stop runs first (the departure sheet, which
   * ends the workday on Confirm). Between moves there is nothing to depart
   * from, so it asks "End this workday?" and ends it.
   */
  const requestEndWorkday = (workdayId: string) => {
    const workday = getActiveWorkday()
    if (!workday || workday.id !== workdayId) return
    const home = workdayHome(workday, loadSessions())
    if (home.phase === 'parked' && home.currentLeg) {
      openDepartureSheet(home.currentLeg, 'active.iveLeftConfirm', { id: workday.id, action: 'end' })
    } else {
      setWorkdayEndId(workday.id)
    }
  }

  const endWorkdayNow = (workdayId: string) => {
    try {
      endWorkday(workdayId)
    } catch (err) {
      console.warn('[workday] could not end the workday:', err)
    }
  }

  const workdayEndDialog = workdayEndId ? (
    <WorkdayEndDialog
      onConfirm={() => {
        const id = workdayEndId
        setWorkdayEndId(null)
        endWorkdayNow(id)
      }}
      onCancel={() => setWorkdayEndId(null)}
      returnFocus={() => firstFocusTarget(HOME_SCAN_ID)}
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
    // A shared copy (T7) lives on this device only: it was never uploaded
    // and has no reminders, so there is nothing else to undo.
    if (session.shared_from) {
      setView({ name: 'history' })
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
          workdayLeg={workdayScan}
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
          noSignReading={view.unread?.reading ?? null}
          coords={view.coords}
          // The no-sign path has no scan views to carry a draft, so its
          // arrival_context starts from a fresh one (only the driver saved in
          // Settings). From the "no readable sign" screen it is that scan's draft.
          onComplete={(session) =>
            void handleSessionSaved(session, view.unread?.back.draft ?? logDraftFromProfile(loadProfile()))
          }
          onCancel={() => setView(view.unread ? view.unread.back : { name: 'home' })}
        />
      </main>
    )
  }

  if (view.name === 'noReadableSign') {
    const reading = noSignReadingOf(view.result)
    return (
      <main className="min-h-screen">
        <NoReadableSign
          result={view.result}
          signPhoto={view.signPhoto}
          onRetake={() => setView({ name: 'scan' })}
          // The scan photo becomes the record's surroundings photo, keeping
          // its own capture time and source.
          onLogWithoutSign={() =>
            setView({
              name: 'logNoSign',
              coords: view.coords,
              ambientPhoto: view.signPhoto,
              ambientPhotoMeta: view.signPhotoMeta,
              unread: reading ? { reading, back: view } : undefined,
            })
          }
          onBack={() => setView({ name: 'home' })}
          // A workday stop needs a readable sign (T6b item 7): Retake photo
          // or End workday, never "Log without a sign". Between moves there
          // is no stop to depart from, so the workday just ends.
          onEndWorkday={
            view.draft.workday
              ? () => {
                  endWorkdayNow(view.draft.workday!.workday_id)
                  setView({ name: 'home' })
                }
              : undefined
          }
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
            onClick={openScan}
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
          // A workday stop (T6b items 5 and 6): no "Scan another", and Back
          // goes home with the workday still between moves.
          onScanAnother={view.draft.workday ? undefined : () => setView({ name: 'scan' })}
          onBack={view.draft.workday ? () => setView({ name: 'home' }) : undefined}
          // The gate answers and the permit the driver confirmed (T4) go
          // into the draft, and from there onto the record and link 1.
          onLogSession={(answers) =>
            setView({
              name: 'logging',
              result: view.result,
              signPhoto: view.signPhoto,
              signPhotoMeta: view.signPhotoMeta,
              coords: view.coords,
              draft: withResultAnswers(view.draft, answers),
            })
          }
          onRetake={() => setView({ name: 'scan' })}
          isFirstSave={loadSessions().length === 0}
          // The saved permits the scan was read with (T4 item 4), and the
          // state for "under {{state}} rules", only when the coordinates
          // place it for sure. A fresh scan has no reverse-geocoded place
          // yet (T6a's jurisdiction comes when the logger geocodes), so this
          // stays the no-network check; a re-check of a saved record uses
          // the record's own jurisdiction (parkingStateForRecord).
          permits={usablePermits(loadProfile())}
          parkingState={parkingStateForCoords(view.coords)}
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
          draft={view.draft}
          onComplete={(session) => void handleSessionSaved(session, view.draft)}
          // Backing out of a workday stop's logger returns home with the
          // workday still between moves (T6b item 6).
          onCancel={() =>
            setView(
              view.draft.workday
                ? { name: 'home' }
                : {
                    name: 'result',
                    result: view.result,
                    signPhoto: view.signPhoto,
                    signPhotoMeta: view.signPhotoMeta,
                    coords: view.coords,
                    draft: view.draft,
                  },
            )
          }
        />
      </main>
    )
  }

  if (view.name === 'remind') {
    return (
      <main className="min-h-screen">
        {view.workdayStopped && (
          <div className="max-w-md mx-auto w-full px-6 pt-6">
            <div role="alert" className="gf-card bg-amber-50 p-4 flex items-start gap-3">
              <Icon name="warning" className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <p className="text-sm text-ink-900 leading-relaxed">{t(WORKDAY_STOPPED_KEYS[view.workdayStopped])}</p>
            </div>
          </div>
        )}
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
          // One row per workday, opening the workday view (T6b item 5).
          onOpenWorkday={workdayOn ? (workdayId) => setView({ name: 'workday', workdayId, back: 'history' }) : undefined}
        />
        {backupPrompt}
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

  if (view.name === 'shared') {
    return (
      <main className="min-h-screen">
        {/* Keyed by the link, so a second link opened meanwhile starts afresh. */}
        <SharedLinkView key={view.token} token={view.token} onDone={() => setView({ name: 'home' })} />
      </main>
    )
  }

  if (view.name === 'session' && view.session.shared_from) {
    // A read-only copy from a share link (T7 item 4): countdown, Directions,
    // "Check the signature" and Remove only.
    return (
      <main className="min-h-screen">
        <SharedRecordScreen
          session={view.session}
          onBack={() => setView({ name: 'history' })}
          onRemove={handleDeleteRecord}
        />
      </main>
    )
  }

  if (view.name === 'session') {
    return (
      <main className="min-h-screen">
        <SessionDetail
          session={view.session}
          onBack={() =>
            setView(view.returnTo ? { name: 'workday', ...view.returnTo } : { name: 'history' })
          }
          onDelete={handleDeleteRecord}
          // Hand the appeal flow the stored copy, which may have gained a
          // signature or an end time since this view opened.
          onDraftAppeal={() =>
            setView({ name: 'appeal', session: getSession(view.session.id) ?? view.session })
          }
          // SessionDetail re-reads its record on the records-changed event,
          // so the "Ended ..." row shows without patching the view here.
          onEndSession={(s) => openDepartureSheet(s, 'session.endConfirm')}
          onSheetOpenChange={setRecordSheetOpen}
        />
        {departureSheetView}
        {workdayEndDialog}
        {!departureSheet && !recordSheetOpen && backupPrompt}
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
          // After a failed reading there is no snapshot: the appeal flow
          // captures the photo itself, and its Back goes home.
          onDraftAppeal={(session, snapshot) =>
            setView({
              name: 'appeal',
              session: session ? (getSession(session.id) ?? session) : null,
              notice: snapshot?.photo,
              returnTo: snapshot ?? undefined,
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
        <Settings
          onBack={() => setView({ name: 'home' })}
          onOpenAccount={() => setView({ name: 'account' })}
          onSignIn={() => setView({ name: 'signin' })}
          onOpenPrivacy={() => setView({ name: 'privacy', back: 'settings' })}
        />
      </main>
    )
  }

  if (view.name === 'account') {
    return (
      <main className="min-h-screen">
        <AuthSettings
          onBack={() => setView({ name: 'settings' })}
          onOpenPrivacy={() => setView({ name: 'privacy', back: 'account' })}
          onDeleted={() => setView({ name: 'home' })}
        />
      </main>
    )
  }

  if (view.name === 'privacy') {
    const back = view.back
    return (
      <main className="min-h-screen">
        <PrivacyPolicy
          onBack={() =>
            setView(back === 'settings' ? { name: 'settings' } : back === 'account' ? { name: 'account' } : { name: 'home' })
          }
        />
      </main>
    )
  }

  if (view.name === 'recurring') {
    return (
      <main className="min-h-screen">
        <RecurringReminders onBack={() => setView({ name: 'home' })} />
      </main>
    )
  }

  if (view.name === 'workdayStart' && workdayOn) {
    return (
      <main className="min-h-screen">
        <WorkdayStart
          // The record home shows as active: the only way in while one is
          // active is to use it as the first stop (T6b item 4).
          activeRecord={activeSessions[0] ?? null}
          firstWorkday={isFirstWorkday(loadWorkdays())}
          onStart={handleStartWorkday}
          onBack={() => setView({ name: 'home' })}
        />
      </main>
    )
  }

  if (view.name === 'workday' && workdayOn) {
    const back = view.back
    const target: WorkdayViewTarget = { workdayId: view.workdayId, back }
    return (
      <main className="min-h-screen">
        <WorkdayView
          workdayId={view.workdayId}
          backLabelKey={back === 'home' ? 'common.backToHome' : 'common.backToHistory'}
          onBack={() => setView(back === 'home' ? { name: 'home' } : { name: 'history' })}
          onOpenStop={(leg) => setView({ name: 'session', session: leg, returnTo: target })}
          onEnd={activeWorkday?.id === view.workdayId ? () => requestEndWorkday(view.workdayId) : undefined}
        />
        {departureSheetView}
        {workdayEndDialog}
        <Toast message={notice} onClose={() => setNotice(null)} />
      </main>
    )
  }

  if (view.name === 'about') {
    return (
      <main className="min-h-screen">
        <AboutFeatures
          onBack={() => setView({ name: 'home' })}
          onTryIt={openScan}
        />
      </main>
    )
  }

  // The useNow tick at the top of the function drives:
  //  (a) the active-session card's countdown stays live without manual refresh
  //  (b) when an active session crosses its expiry, it falls out of the
  //      filter and the card disappears on the next tick
  const allRecords = loadSessions()
  const sessionCount = allRecords.length
  // Workday mode (T6b item 5): while a workday is active, its card replaces
  // the active card, whether or not the stop's limit has passed. Other
  // active records wait behind its "+N more" pill.
  const workdayState: WorkdayHome | null = activeWorkday ? workdayHome(activeWorkday, allRecords) : null
  const otherActives = workdayState
    ? activeSessions.filter((s) => s.id !== workdayState.currentLeg?.id)
    : activeSessions
  const primaryActive = workdayState ? undefined : activeSessions[0]
  const hasLiveCard = !!primaryActive || !!workdayState
  // A first visit: nothing saved and nothing active. History (and the weekly
  // reminders row, until a reminder is set) stay off the home screen.
  const firstVisit = sessionCount === 0 && !hasLiveCard

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
        {!hasLiveCard && sessionCount === 0 ? (
          <div className="flex justify-end">
            <LanguageSelector />
          </div>
        ) : hasLiveCard ? (
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
        {!(!hasLiveCard && sessionCount === 0) && (
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
        {/* Home layout (T4 item 9), first: the active card, or the workday
            card while a workday is active (T6b puts it here, in place of
            this one). The card gains only a Share icon (T7). */}
        {workdayState && (
          <div className="w-full mb-6">
            <WorkdayCard
              home={workdayState}
              readiness={workdayReadiness}
              extraCount={otherActives.length}
              onShowMore={() => setView({ name: 'actives' })}
              onOpen={() => setView({ name: 'workday', workdayId: workdayState.workday.id, back: 'home' })}
              onMove={(leg) =>
                openDepartureSheet(leg, 'active.iveLeftConfirm', { id: workdayState.workday.id, action: 'move' })
              }
              onScan={handleWorkdayScan}
              onEnd={() => requestEndWorkday(workdayState.workday.id)}
              onShare={(leg) => setShareSheet(getSession(leg.id) ?? leg)}
              reminderSummary={
                stopReminders && stopReminders.legId === workdayState.currentLeg?.id ? stopReminders.summary : undefined
              }
              reminderBooking={!!stopReminders?.booking && stopReminders.legId === workdayState.currentLeg?.id}
              onRetryReminders={() => {
                const legId = workdayState.currentLeg?.id
                if (legId) void setStopRemindersFor(legId, true)
              }}
              // "Turn on notifications" on the card (T6b item 2): the browser
              // asks inside this tap (remindMe asks first), then the stop's
              // reminders are booked.
              onAllowReminders={async () => {
                const legId = workdayState.currentLeg?.id
                if (legId) await setStopRemindersFor(legId, true)
                else refreshWorkdayReadiness()
              }}
            />
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
              // A workday stop never offers Re-check now (T6b item 5): it
              // would give a car that hasn't moved a new arrival time. (Its
              // card shows here only when its workday isn't on this device.)
              onRecheck={primaryActive.workday_id ? undefined : handleReuseSession}
              // Share slot (T4 item 9): the card shows its Share icon
              // beside the "+N more" pill, and the sheet asks first (T7).
              onShare={(s) => setShareSheet(getSession(s.id) ?? s)}
            />
          </div>
        )}

        {/* Landing experience — first-time visitors only.
            Conditional on (no active session) AND (no saved sessions).
            This component owns the full hero (split-colour headline,
            three value bullets, gradient CTA, How-it-works, evidence
            callout). It includes its own scan-button CTA, so we DON'T
            render the standard scan button below for first-time visitors. */}
        {!hasLiveCard && sessionCount === 0 ? (
          <LandingFeatures
            onScanCta={openScan}
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
        ) : workdayState ? null : (
          // During a workday the card's own scan replaces this one, and
          // "Scan another" is hidden (T6b item 5).
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

        {/* The home layout below the scan button (T4 item 9): History,
            "Street sweeping and weekly reminders" and Settings as glass rows,
            then "Parking all day? Start a workday", then "Got a fine? Start
            here". The returning-user 3-step list is gone. Rows whose screens
            live on other branches render only when their handler is passed
            here:
            - the weekly reminders row (T5a) opens the recurring view and
              names the next occurrence inline when it is within 24 hours.
              Like History it stays off a first visit (nothing saved,
              nothing active) unless a reminder is already set.
            - "Parking all day? Start a workday" (T6b item 1) opens the
              workday start screen. Only with VITE_FEATURE_WORKDAY on, never
              during a workday, and not when the last record's state is known
              and isn't Victoria or Queensland (showStartWorkdayLink).
            - "Got a fine? Start here" opens the notice lookup (T8), which is
              also the way in to an appeal (the appeal handler is only
              HomeMenu's fallback while no lookup is wired).
            Settings works without an account, so it is always there. */}
        <HomeMenu
          showHistory={!firstVisit}
          recordCount={sessionCount}
          onOpenHistory={() => setView({ name: 'history' })}
          onOpenWeeklyReminders={
            !firstVisit || recurringRules.length > 0 ? () => setView({ name: 'recurring' }) : undefined
          }
          weeklyRemindersNext={recurringHomeNext(recurringRules, now, t)}
          weeklyRemindersDetail={recurringHomeCount(recurringRules, t)}
          onOpenSettings={() => setView({ name: 'settings' })}
          syncAvailable={auth.configured}
          accountEmail={auth.user?.email ?? null}
          onStartWorkday={
            showStartWorkdayLink({ enabled: workdayOn, activeWorkday, sessions: allRecords })
              ? () => setView({ name: 'workdayStart' })
              : undefined
          }
          onOpenNoticeLookup={() => setView({ name: 'notice', snapshot: null })}
          onDraftAppeal={() => setView({ name: 'appeal', session: null })}
        />

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
      {workdayEndDialog}
      {shareSheet && (
        <ShareSheet
          session={shareSheet}
          onClose={() => setShareSheet(null)}
          returnFocus={() => firstFocusTarget(HOME_SCAN_ID)}
        />
      )}
      {!departureSheet && !feedbackOpen && !shareSheet && !workdayEndId && backupPrompt}
      <Toast message={notice} onClose={() => setNotice(null)} />
    </main>
  )
}

export default App
