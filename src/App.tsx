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
import LanguageSelector from './components/LanguageSelector'
import Icon from './components/Icon'
import LoadingProgress from './components/LoadingProgress'
import { refreshInterpretation, translateSign } from './lib/claude'
import { loadActiveSessions, loadSessions, saveSession, updateSession } from './lib/storage'
import { retryUnsignedSessions, signSession } from './lib/signing'
import { useAuth } from './lib/use-auth'
import {
  mirrorSessionToCloud,
  mirrorSessionUpdateToCloud,
  performInitialSync,
} from './lib/sync'
import { handleCallback as handleFederatedCallback } from './lib/federated-auth'
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
  | { name: 'appeal'; session: ParkingSession }
  | { name: 'signin' }
  | { name: 'settings' }
  | { name: 'privacy' }
  | { name: 'error'; message: string }

function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
}

function App() {
  const [view, setView] = useState<View>({ name: 'home' })
  const auth = useAuth()
  const { t } = useTranslation()

  // Hooks must run unconditionally on every render — keep these above the
  // view-name early-returns. The home view consumes them; non-home views
  // pay a negligible cost (one localStorage read + a 30s interval).
  const now = useNow(30_000)
  const activeSessions = useMemo(() => loadActiveSessions(now), [now])

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
          // Clean the OAuth params out of the URL — leaves the page on / with
          // the user signed in.
          window.history.replaceState({}, '', window.location.pathname)
          await auth.refresh()
        }
      } catch (err) {
        console.warn('[auth] federated callback failed:', err)
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
  const userId = auth.user?.userId
  useEffect(() => {
    if (!userId) return
    void performInitialSync().catch((err) => {
      console.warn('[sync] initial sync failed:', err)
    })
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
      setView({ name: 'error', message })
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
      setView({ name: 'error', message })
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
      }
      // No-sign sessions skip the reminder step — there's no expiry to remind
      // about. They go straight back to the home screen, where the saved
      // session is visible in History.
      setView(session.no_sign ? { name: 'home' } : { name: 'remind', session })
      // Mirror to cloud immediately when signed in. Fire-and-forget — local
      // is the source of truth, the cloud is a best-effort backup.
      if (auth.user) {
        mirrorSessionToCloud(session)
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
        <div className="w-16 h-16 rounded-full bg-accent-100 border-2 border-accent-500 text-accent-700 flex items-center justify-center mb-4">
          <Icon name="warning" className="w-8 h-8" />
        </div>
        <h2 className="font-display text-2xl font-extrabold text-ink-900">{t('errors.somethingWrong')}</h2>
        <p className="text-sm text-ink-700 mt-3 mb-6 break-words">{view.message}</p>
        <div className="flex flex-col gap-2 w-full">
          <button
            onClick={() => setView({ name: 'scan' })}
            className="bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-semibold py-3 rounded-2xl shadow-md transition-colors"
          >
            {t('errors.tryAgain')}
          </button>
          <button
            onClick={() => setView({ name: 'home' })}
            className="bg-paper-200 hover:bg-paper-300 text-ink-900 font-medium py-3 rounded-2xl transition-colors"
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
        />
      </main>
    )
  }

  if (view.name === 'appeal') {
    return (
      <main className="min-h-screen">
        <AppealFlow
          session={view.session}
          onBack={() => setView({ name: 'session', session: view.session })}
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

  // The useNow tick at the top of the function drives:
  //  (a) the active-session card's countdown stays live without manual refresh
  //  (b) when an active session crosses its expiry, it falls out of the
  //      filter and the card disappears on the next tick
  const sessionCount = loadSessions().length
  const primaryActive = activeSessions[0]

  return (
    <main className="min-h-screen flex flex-col relative">
      <header className="px-6 pt-6 pb-2 text-center">
        {primaryActive ? (
          // Replace the decorative hero with the live status when there's an
          // active session — it's the most useful information on the screen
          // at that moment, and competes for the same visual real estate.
          <h1 className="font-display text-3xl font-extrabold text-ink-900 tracking-tight">
            ParkProof
          </h1>
        ) : (
          <>
            <img
              src="/hero-illustration.svg"
              alt=""
              className="w-full max-w-[360px] mx-auto mb-2 select-none pointer-events-none"
              aria-hidden
            />
            <h1 className="font-display text-4xl font-extrabold text-ink-900 tracking-tight">
              ParkProof
            </h1>
            <p className="text-sm text-ink-600 mt-2 max-w-[20rem] mx-auto leading-relaxed">
              {t('home.tagline')}
            </p>
          </>
        )}
        {/* Language selector — always present on the home header. Tiny
            footprint above the rest of the content; the active flag's
            highlight makes the current choice obvious without explanation. */}
        <div className="mt-4">
          <LanguageSelector />
        </div>
      </header>

      <section className="flex-1 px-6 pb-8 flex flex-col items-center justify-center max-w-md mx-auto w-full">
        {primaryActive && (
          <div className="w-full mb-6">
            <ActiveSessionCard
              session={primaryActive}
              extraCount={activeSessions.length - 1}
              onOpen={(s) => setView({ name: 'session', session: s })}
              onShowMore={() => setView({ name: 'actives' })}
            />
          </div>
        )}

        <button
          onClick={() => setView({ name: 'scan' })}
          className="w-full bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white text-lg font-semibold py-5 rounded-2xl shadow-lg shadow-brand-500/25 flex items-center justify-center gap-3 transition-colors"
        >
          <Icon name="camera" className="w-6 h-6" />
          {primaryActive ? t('home.scanAnother') : t('home.scanCta')}
        </button>

        {!primaryActive && (
          <p className="text-xs text-ink-600/80 mt-4 text-center">
            {t('home.scanHelp')}
          </p>
        )}

        {/* Long translations (Italian / Hindi / Punjabi) wrap to two lines.
            Use items-start + flex-1 min-w-0 so the icon anchors to the first
            line and the right-side label sits flush with it, instead of all
            three drifting to the vertical centre of the 2-line text block. */}
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

        {/* Auth affordance — only renders when Cognito is wired in. Anonymous
            users see a "Sign in to sync" CTA; signed-in users see their email
            + a cog icon that opens settings. Skipped entirely on builds
            without auth credentials (open-source / first-time clones). */}
        {auth.configured && (
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

        {!primaryActive && (
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

        <button
          onClick={() => setView({ name: 'privacy' })}
          className="mt-8 text-xs text-ink-500 hover:text-ink-700 underline self-center"
        >
          {t('common.privacy')}
        </button>
      </section>
    </main>
  )
}

export default App
