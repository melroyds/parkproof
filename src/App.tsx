import { useEffect, useMemo, useState } from 'react'
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
import ActiveSessionCard from './components/ActiveSessionCard'
import ActiveSessionsList from './components/ActiveSessionsList'
import AuthFlow from './components/AuthFlow'
import AuthSettings from './components/AuthSettings'
import PrivacyPolicy from './components/PrivacyPolicy'
import FeedbackModal from './components/FeedbackModal'
import LandingFeatures from './components/LandingFeatures'
import AboutFeatures from './components/AboutFeatures'
import LanguageSelector from './components/LanguageSelector'
import BrandMark from './components/BrandMark'
import Icon from './components/Icon'
import LoadingProgress from './components/LoadingProgress'
import { refreshInterpretation, translateSign } from './lib/claude'
import {
  endSession,
  loadActiveSessions,
  loadSessions,
  saveSession,
  updateSession,
} from './lib/storage'
import { retryUnsignedSessions, signSession } from './lib/signing'
import { useAuth } from './lib/use-auth'
import {
  mirrorSessionToCloud,
  mirrorSessionUpdateToCloud,
  performInitialSync,
} from './lib/sync'
import { handleCallback as handleFederatedCallback } from './lib/federated-auth'
import { cancelPushReminders } from './lib/push'
import type { ParkingRules, ParkingSession, RuleVariant } from './types'

type Coords = { lat: number; lng: number } | null

type View =
  | { name: 'home' }
  | { name: 'scan' }
  | { name: 'loading' }
  | { name: 'clarify'; result: ParkingRules; signPhoto: string; coords: Coords }
  | { name: 'result'; result: ParkingRules; signPhoto: string; coords: Coords }
  | { name: 'logging'; result: ParkingRules; signPhoto: string; coords: Coords }
  /**
   * "No sign here" flow — user parked at a spot with no signage and wants a
   * GPS + time evidence record without the AI translation. The ambient photo
   * (optional, opt-in) demonstrates absence of signs.
   */
  | { name: 'logNoSign'; coords: Coords; ambientPhoto: string | null }
  | { name: 'remind'; session: ParkingSession }
  | { name: 'history' }
  | { name: 'actives' }
  | { name: 'session'; session: ParkingSession }
  | { name: 'appeal'; session: ParkingSession | null }
  | { name: 'signin' }
  | { name: 'settings' }
  | { name: 'privacy' }
  | { name: 'about' }
  | { name: 'error'; message: string; offline?: boolean }

function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
}

/** True when the browser reports no network — drives the offline error state. */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
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
      className="fixed bottom-4 inset-x-4 z-50 max-w-md mx-auto bg-ink-900 text-white rounded-xl shadow-sm p-4 flex items-start gap-3"
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
  const [view, setView] = useState<View>({ name: 'home' })
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  // Transient save-time notice (quota recovery, photo-sync failure). Auto-clears.
  const [notice, setNotice] = useState<string | null>(null)
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
  // `activesVersion` lets us force a re-derive of the active-sessions list
  // when something happens that touches the underlying localStorage data
  // (end-session, new save) but doesn't otherwise change `now`. Without it,
  // the home-screen card can linger for up to 30 seconds after the user
  // taps "I've left".
  const [activesVersion, setActivesVersion] = useState(0)
  const activeSessions = useMemo(
    () => loadActiveSessions(now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now, activesVersion],
  )

  // On app start, sweep localStorage for sessions that landed unsigned (tab
  // closed mid-signing) and retry them in the background. Throttled per
  // session inside the helper — safe to invoke on every mount.
  useEffect(() => {
    retryUnsignedSessions()
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
  // After the sync settles (success OR error) we bump `activesVersion` so the
  // home view re-derives. Without this, a signed-in user on a fresh device
  // sees the "first-time visitor" LandingFeatures forever — sessionCount is
  // computed inline at render time and there's nothing to trigger one once
  // the pulled-from-cloud sessions land in localStorage.
  const userId = auth.user?.userId
  const runInitialSync = () => {
    if (!userId) return
    // Note: syncError is cleared by the retry handler, NOT here — calling
    // setState synchronously from the mount effect that invokes this would trip
    // the cascading-render lint rule. The async branches below are fine.
    void performInitialSync()
      .then((res) => {
        // Couldn't reach the cloud AND nothing local to fall back on → a
        // returning user on a fresh device would otherwise see the first-time
        // landing with no clue their data is fine in the cloud. Offer a retry.
        if (res.listFailed && loadSessions().length === 0) setSyncError(true)
      })
      .catch((err) => {
        console.warn('[sync] initial sync failed:', err)
        if (loadSessions().length === 0) setSyncError(true)
      })
      .finally(() => {
        setActivesVersion((v) => v + 1)
      })
  }
  useEffect(() => {
    runInitialSync()
    // Mount / sign-in only — keyed on userId. runInitialSync is recreated each
    // render, so listing it as a dep would re-sync on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const handleCapture = async (
    dataUrl: string,
    mediaType: string,
    coords: { lat: number; lng: number } | null,
  ) => {
    setView({ name: 'loading' })
    try {
      const base64 = stripDataUrlPrefix(dataUrl)
      const result = await translateSign(base64, mediaType, coords)
      if (result.clarification && result.clarification.options.length > 1) {
        setView({ name: 'clarify', result, signPhoto: dataUrl, coords })
      } else {
        setView({ name: 'result', result, signPhoto: dataUrl, coords })
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
    coords: Coords,
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
    setView({ name: 'result', result: merged, signPhoto, coords })
  }

  const handleReuseSession = async (session: ParkingSession) => {
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
      }
      // Reuse the prior session's coords for the result view — they're a
      // strict superset of what handleCapture would pass and they correctly
      // anchor the result-screen timezone to where the user was parked.
      const reusedCoords: Coords = session.location
        ? { lat: session.location.lat, lng: session.location.lng }
        : null
      // No-sign sessions are filtered out of the smart-rescan match list,
      // so in practice sign_photo is always non-null here. Runtime guard
      // for TS narrowness + as a defensive backstop.
      if (!session.sign_photo) return
      setView({ name: 'result', result, signPhoto: session.sign_photo, coords: reusedCoords })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setView({ name: 'error', message, offline: isOffline() })
    }
  }

  const handleSessionSaved = (session: ParkingSession) => {
    try {
      const report = saveSession(session)
      // If the quota recovery had to evict or strip old sessions to fit, log
      // it so the diagnostic surfaces in the console. We don't block the user
      // — they get straight to the reminder screen — but the History view
      // will reflect the cleanup on next render.
      if (report.evicted > 0 || report.trimmedPhotosFrom > 0) {
        console.info(
          `[storage] freed space for this session — stripped photos from ${report.trimmedPhotosFrom}, evicted ${report.evicted} old session(s).`,
        )
        // Tell the user — silently deleting evidence photos to fit a new save
        // contradicts the whole "your evidence is safe" promise. Point them at
        // sign-in as the durable fix.
        setNotice(
          t('errors.storageRecovered', {
            count: report.trimmedPhotosFrom + report.evicted,
          }),
        )
      }
      // No-sign sessions skip the reminder step — there's no expiry to remind
      // about. They go straight back to the home screen, where the saved
      // session is visible in History.
      // No-sign sessions used to skip ReminderOptions because the picker
      // only knew about "X min before expiry" and there's no expiry on a
      // no-sign session. The picker now supports an open-ended "remind
      // me in N hours" mode, so route everyone through it — the driver
      // can pick "1 hour" / "4 hours" / etc. to check on their car.
      setView({ name: 'remind', session })
      // Bump the actives memo so the home card surfaces the new session
      // immediately rather than waiting for the next 30s tick. Mostly
      // relevant for no-sign sessions that route straight back to home.
      setActivesVersion((v) => v + 1)
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
            setActivesVersion((v) => v + 1)
            setNotice(t('errors.photoSyncFailed'))
          }
        })
      }
      // Sign the evidence asynchronously — never blocks the reminder flow.
      // If it succeeds, patch the saved session with the signature bundle so
      // the PDF + SessionDetail can show it. Errors are swallowed (best-effort
      // enrichment); the signing-retry task handles the unsigned-tab-closed case.
      void signSession(session)
        .then((signature) => {
          if (signature) {
            try {
              updateSession(session.id, { signature })
              if (auth.user) {
                mirrorSessionUpdateToCloud(session.id)
              }
            } catch (err) {
              console.warn('[signing] could not persist signature:', err)
            }
          }
        })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setView({ name: 'error', message })
    }
  }

  /**
   * User signalled "I've left". Stamps ended_at on the session, mirrors the
   * change to cloud when signed in, and bumps the actives memo so the home
   * card disappears immediately rather than lingering for up to 30s.
   *
   * Non-destructive — the session stays in history with the ended-at stamp
   * preserved for the evidence record.
   */
  const handleEndSession = (session: ParkingSession) => {
    try {
      endSession(session.id)
      setActivesVersion((v) => v + 1)
      if (auth.user) mirrorSessionUpdateToCloud(session.id)
      // Fire-and-forget: cancel any pending Web Push reminders for this
      // session server-side. Without this, EventBridge would keep firing
      // pushes ("30 min until parking expires") after the user has already
      // left — annoying and undermines trust in the reminders. Best-effort:
      // the local ended_at stamp is the source of truth; if the cancel
      // network call fails, the worst case is a stale push fires later.
      void cancelPushReminders(session.id)
    } catch (err) {
      console.warn('[storage] could not end session:', err)
    }
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
        <h2 className="font-display text-2xl font-extrabold text-ink-900">
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
          onNoSignScan={(coords, ambientPhoto) =>
            setView({ name: 'logNoSign', coords, ambientPhoto })
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
          coords={view.coords}
          onComplete={handleSessionSaved}
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
          <h2 className="font-display text-2xl font-extrabold text-ink-900">
            {view.offline ? t('errors.offlineTitle') : t('errors.somethingWrong')}
          </h2>
          <p className="text-sm text-ink-700 mt-3 mb-6 break-words">
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
            handlePickVariant(variant, view.result, view.signPhoto, view.coords)
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
              coords: view.coords,
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
          onComplete={handleSessionSaved}
          onCancel={() =>
            setView({
              name: 'result',
              result: view.result,
              signPhoto: view.signPhoto,
              coords: view.coords,
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
          onDeleted={() => setView({ name: 'history' })}
          onDraftAppeal={() => setView({ name: 'appeal', session: view.session })}
          onEndSession={(updated) => {
            handleEndSession(updated)
            // Patch the view's session so the detail screen re-renders with
            // ended_at set — surfaces the "Ended {{when}}" row immediately
            // and hides the End-session button.
            setView({ name: 'session', session: updated })
          }}
        />
      </main>
    )
  }

  if (view.name === 'appeal') {
    return (
      <main className="min-h-screen">
        <AppealFlow
          session={view.session}
          onBack={() =>
            setView(
              view.session
                ? { name: 'session', session: view.session }
                : { name: 'home' },
            )
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
    <main className="min-h-screen flex flex-col relative">
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
            <BrandMark variant="glyph" className="w-8 h-8" />
            <h1 className="font-display text-3xl font-extrabold text-ink-900 tracking-tight">
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
              <BrandMark variant="glyph" className="w-9 h-9" />
              <h1 className="font-display text-4xl font-extrabold text-ink-900 tracking-tight">
                ParkProof
              </h1>
            </div>
            <p className="text-sm text-ink-600 mt-2 max-w-[20rem] mx-auto leading-relaxed">
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
              onEndSession={handleEndSession}
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
              onClick={() => setView({ name: 'scan' })}
              className="w-full bg-brand-500 hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-300 text-white text-lg font-semibold py-4 rounded-xl shadow-sm shadow-brand-900/10 flex items-center justify-center gap-3 transition-colors"
            >
              <Icon name="camera" className="w-6 h-6" />
              {primaryActive ? t('home.scanAnother') : t('home.scanCta')}
            </button>

            {!primaryActive && (
              <p className="text-xs text-ink-600/80 mt-4 text-center">
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
            className="mt-8 w-full bg-white hover:bg-paper-50 border border-paper-300 text-ink-900 font-medium py-3 rounded-2xl flex items-start justify-between gap-3 px-5 transition-colors"
          >
            <span className="flex items-start gap-2 min-w-0 flex-1">
              <Icon name="list" className="w-5 h-5 text-ink-600 shrink-0 mt-px" />
              <span className="leading-snug text-left">{t('home.history')}</span>
            </span>
            <span className="text-sm text-ink-600 shrink-0 mt-px">
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
              className="mt-2 w-full bg-white hover:bg-paper-50 border border-paper-300 text-ink-900 font-medium py-3 rounded-2xl flex items-start justify-between gap-3 px-5 transition-colors"
            >
              <span className="flex items-start gap-2 min-w-0 flex-1">
                <Icon name="check" className="w-5 h-5 text-brand-600 shrink-0 mt-px" strokeWidth={2.5} />
                <span className="truncate">{auth.user.email}</span>
              </span>
              <span className="text-xs text-ink-600 shrink-0 mt-1">{t('home.account')}</span>
            </button>
          ) : (
            <button
              onClick={() => setView({ name: 'signin' })}
              className="mt-2 w-full bg-white hover:bg-paper-50 border border-paper-300 text-ink-900 font-medium py-3 rounded-2xl flex items-start justify-between gap-3 px-5 transition-colors"
            >
              <span className="flex items-start gap-2 min-w-0 flex-1">
                <Icon name="bell" className="w-5 h-5 text-ink-600 shrink-0 mt-px" />
                <span className="leading-snug text-left">{t('home.signInToSync')}</span>
              </span>
              <span className="text-xs text-ink-600 shrink-0 mt-1">{t('common.optional')}</span>
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
                <span className="font-display text-2xl font-extrabold text-brand-500 leading-none w-7 text-center shrink-0">
                  {i + 1}
                </span>
                <span className="text-sm text-ink-700 leading-relaxed pt-1">{text}</span>
              </li>
            ))}
          </ol>
        )}

        {/* Standalone appeal entry — reachable for the highest-intent user:
            someone who got a ticket and found ParkProof to fight it, but never
            logged a park here. Routes into AppealFlow with no linked session;
            the flow drafts from the infringement notice alone. */}
        <button
          onClick={() => setView({ name: 'appeal', session: null })}
          className="mt-8 text-sm text-brand-700 hover:text-brand-800 font-medium underline self-center min-h-[44px] inline-flex items-center py-2.5"
        >
          {t('home.draftAppeal')}
        </button>

        <div className="mt-6 flex items-center justify-center gap-6 self-center flex-wrap">
          <button
            onClick={() => setView({ name: 'about' })}
            className="text-xs text-ink-700 hover:text-ink-900 underline min-h-[44px] inline-flex items-center -my-2.5"
          >
            {t('common.about')}
          </button>
          <button
            onClick={() => setView({ name: 'privacy' })}
            className="text-xs text-ink-700 hover:text-ink-900 underline min-h-[44px] inline-flex items-center -my-2.5"
          >
            {t('common.privacy')}
          </button>
          <button
            onClick={() => setFeedbackOpen(true)}
            className="text-xs text-ink-700 hover:text-ink-900 underline min-h-[44px] inline-flex items-center -my-2.5"
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
      <Toast message={notice} onClose={() => setNotice(null)} />
    </main>
  )
}

export default App
