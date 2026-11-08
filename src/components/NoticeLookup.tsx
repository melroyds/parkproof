import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { resizeImageFile } from '../lib/image'
import { matchNotice, noticeLocalTime, parseWallClock, type NoticeMatch } from '../lib/notice-match'
import { noticeComparison, renderComparisonLine } from '../lib/notice-compare'
import { NOTICE_READING_STAGES, readNoticeSnapshot, type NoticeSnapshot } from '../lib/notice-read'
import { deviceRecordContext, recordTimes } from '../lib/record-times'
import { formatInZone } from '../lib/time-format'
import { useLiveRecords } from '../lib/use-records-version'
import { useNow } from '../lib/use-now'
import LoadingProgress from './LoadingProgress'
import Icon from './Icon'
import Alert from './ui/Alert'
import BackButton from './ui/BackButton'
import Button from './ui/Button'
import Card from './ui/Card'
import Input from './ui/Input'

export type { NoticeSnapshot } from '../lib/notice-read'

interface Props {
  /** A notice already read (coming back from the appeal flow). */
  initial?: NoticeSnapshot | null
  onBack: () => void
  /**
   * "Draft an appeal with this record" (a record) or "Draft an appeal
   * anyway" (null). App opens the appeal flow with the notice photo, which
   * skips its own capture step.
   */
  onDraftAppeal: (session: ParkingSession | null, snapshot: NoticeSnapshot) => void
}

type Stage =
  | { name: 'capture' }
  | { name: 'reading' }
  | { name: 'review'; snapshot: NoticeSnapshot }
  | { name: 'error'; message: string }

const FIELD_LABEL = 'text-xs uppercase tracking-widest font-semibold text-ink-600'

// The PDF chunk, loaded once and shared by the prefetch and the export
// (a failed load is forgotten, so the next tap tries again).
let pdfModule: Promise<typeof import('../lib/pdf')> | null = null
function loadPdfModule(): Promise<typeof import('../lib/pdf')> {
  if (!pdfModule) {
    pdfModule = import('../lib/pdf').catch((err: unknown) => {
      pdfModule = null
      throw err
    })
  }
  return pdfModule
}

export default function NoticeLookup({ initial = null, onBack, onDraftAppeal }: Props) {
  const { t } = useTranslation()
  const [stage, setStage] = useState<Stage>(() =>
    initial ? { name: 'review', snapshot: initial } : { name: 'capture' },
  )
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  // A reading still running when the screen goes away must not set state.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const handleFile = async (file: File) => {
    setStage({ name: 'reading' })
    try {
      // Every photo goes through resizeImageFile (design rules).
      const photo = await resizeImageFile(file)
      const snapshot = await readNoticeSnapshot(photo)
      if (mounted.current) setStage({ name: 'review', snapshot })
    } catch (err) {
      if (mounted.current) setStage({ name: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  // Every stage sits inside App's <main>, so none renders another.
  if (stage.name === 'reading') {
    return <LoadingProgress as="div" stages={NOTICE_READING_STAGES} hintKey="notice.reading.hint" />
  }

  if (stage.name === 'error') {
    return (
      <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
        <BackButton onClick={onBack} className="text-[#A9CFBE] hover:text-paper-50">
          {t('common.backToHome')}
        </BackButton>
        <div className="w-16 h-16 rounded-full bg-accent-100 border-2 border-accent-500 text-accent-700 flex items-center justify-center mb-4 mx-auto">
          <Icon name="warning" className="w-8 h-8" />
        </div>
        <h2 className="font-display text-2xl font-extrabold text-paper-50 text-center">{t('notice.errorHeader')}</h2>
        <p role="alert" className="text-sm mt-3 mb-6 break-words text-center" style={{ color: '#A9CFBE' }}>
          {stage.message}
        </p>
        <Button onClick={() => setStage({ name: 'capture' })}>{t('appeal.tryDifferentPhoto')}</Button>
      </div>
    )
  }

  if (stage.name === 'review') {
    return (
      <NoticeReview
        snapshot={stage.snapshot}
        onChange={(snapshot) => setStage({ name: 'review', snapshot })}
        onRetake={() => setStage({ name: 'capture' })}
        onBack={onBack}
        onDraftAppeal={onDraftAppeal}
      />
    )
  }

  // ── capture ──
  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton onClick={onBack} className="text-[#A9CFBE] hover:text-paper-50">
        {t('common.backToHome')}
      </BackButton>
      <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-1">{t('notice.title')}</h2>
      <p className="text-sm mb-6 leading-relaxed" style={{ color: '#A9CFBE' }}>
        {t('notice.captureIntro')}
      </p>

      <div className="flex flex-col gap-3">
        <button
          onClick={() => cameraInputRef.current?.click()}
          className="border-2 border-dashed border-brand-300 hover:border-brand-500 hover:bg-brand-50/50 bg-white rounded-xl py-8 px-4 flex flex-col items-center text-brand-600 transition-colors"
        >
          <Icon name="camera" className="w-10 h-10 mb-2" />
          <span className="text-sm font-semibold text-ink-900">{t('scanner.takePhoto')}</span>
          <span className="text-xs text-ink-600 mt-1 text-center">{t('scanner.takePhotoSub')}</span>
        </button>
        <button
          onClick={() => libraryInputRef.current?.click()}
          className="border-2 border-dashed border-accent-300 hover:border-accent-500 hover:bg-accent-50/50 bg-white rounded-xl py-8 px-4 flex flex-col items-center text-accent-700 transition-colors"
        >
          <Icon name="gallery" className="w-10 h-10 mb-2" />
          <span className="text-sm font-semibold text-ink-900">{t('scanner.fromLibrary')}</span>
          <span className="text-xs text-ink-600 mt-1 text-center">{t('appeal.captureFromLibrarySub')}</span>
        </button>
      </div>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="notice-camera-input"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
          e.target.value = ''
        }}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="notice-library-input"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
          e.target.value = ''
        }}
      />

      <p className="text-xs mt-6 text-center leading-relaxed" style={{ color: '#A9CFBE' }}>
        {t('notice.disclaimer')}
      </p>
    </div>
  )
}

// ─── The read notice: fields and matches ──────────────────────────────────

interface ReviewProps {
  snapshot: NoticeSnapshot
  onChange: (snapshot: NoticeSnapshot) => void
  onRetake: () => void
  onBack: () => void
  onDraftAppeal: (session: ParkingSession | null, snapshot: NoticeSnapshot) => void
}

function NoticeReview({ snapshot, onChange, onRetake, onBack, onDraftAppeal }: ReviewProps) {
  const { t, i18n } = useTranslation()
  const { fields } = snapshot
  const now = useNow()
  // Re-read on every records change: a departure signed while this screen
  // is open changes its comparison line.
  const allRecords = useLiveRecords()
  // A shared copy is someone else's record: "you tapped I've left" would
  // not be true of it, and it isn't the driver's evidence to appeal with.
  const records = useMemo(() => allRecords.filter((r) => !r.shared_from), [allRecords])
  const local = useMemo(
    () => (snapshot.date && snapshot.time ? parseWallClock(`${snapshot.date}T${snapshot.time}`) : null),
    [snapshot.date, snapshot.time],
  )
  const matches = useMemo(
    () =>
      local
        ? matchNotice({ local, records, noticePoint: snapshot.noticePoint, issuingState: snapshot.issuingState })
        : [],
    [local, records, snapshot.noticePoint, snapshot.issuingState],
  )
  const readTime = useMemo(() => noticeLocalTime(fields), [fields])
  const selected = matches.find((m) => m.session_id === snapshot.selectedId) ?? matches[0] ?? null
  // "Compare with this record" unmounts itself as its card opens: focus
  // then moves to that card's comparison heading, so keyboard and screen
  // reader users land on what just opened rather than on the page.
  const [focusMatchId, setFocusMatchId] = useState<string | null>(null)

  // Pre-load the PDF chunk and the locale's font, as the record screen
  // does, so "Export evidence PDF" stays inside the tap's gesture window
  // (iOS Safari can block a download that follows a slow await).
  const pdfModuleRef = useRef<typeof import('../lib/pdf') | null>(null)
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      loadPdfModule().then((mod) => {
        if (!cancelled) pdfModuleRef.current = mod
      }),
      import('../lib/pdf-fonts').then((mod) => mod.prefetchPdfFont(i18n.language)),
    ]).catch((err) => console.warn('[pdf] prefetch failed:', err))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null)
  const [pdfFailed, setPdfFailed] = useState(false)
  const exportPdf = async (session: ParkingSession) => {
    setPdfFailed(false)
    setPdfBusyId(session.id)
    try {
      const mod = pdfModuleRef.current ?? (await loadPdfModule())
      const { prefetchPdfFont } = await import('../lib/pdf-fonts')
      await prefetchPdfFont(i18n.language)
      const forPdf = await mod.materializeRemotePhotos(session)
      mod.downloadPdf(forPdf, t, i18n.language)
    } catch (err) {
      console.error('[pdf] export failed:', err)
      setPdfFailed(true)
    } finally {
      setPdfBusyId(null)
    }
  }

  const setDate = (date: string) => onChange({ ...snapshot, date, selectedId: null })
  const setTime = (time: string) => onChange({ ...snapshot, time, selectedId: null })
  const offence = [fields.offence_code, fields.offence_description].filter((v): v is string => !!v).join(' ')
  const rows: Array<[string, string | null]> = [
    ['notice.fields.noticeNumber', fields.notice_number],
    ['notice.fields.issuedBy', fields.issuing_authority],
    ['notice.fields.location', fields.location_text],
    ['notice.fields.offence', offence || null],
  ]

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton onClick={onBack} className="text-[#A9CFBE] hover:text-paper-50">
        {t('common.backToHome')}
      </BackButton>
      <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-4">{t('notice.title')}</h2>

      <Card className="mb-6">
        <h3 className={`${FIELD_LABEL} mb-1`}>{t('notice.fields.heading')}</h3>
        <p className="text-xs text-ink-600 mb-4 leading-relaxed">{t('notice.fields.intro')}</p>
        {fields.legibility !== 'clear' && (
          <Alert variant="notice" className="mb-4">
            {t('notice.fields.partlyReadable')}
          </Alert>
        )}
        <dl className="flex flex-col gap-3 mb-4">
          {rows
            .filter(([, value]) => !!value)
            .map(([key, value]) => (
              <div key={key}>
                <dt className={FIELD_LABEL}>{t(key)}</dt>
                <dd className="text-sm text-ink-900 mt-0.5 break-words">{value}</dd>
              </div>
            ))}
        </dl>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="notice-date" className={FIELD_LABEL}>
              {t('notice.fields.date')}
            </label>
            <Input
              id="notice-date"
              type="date"
              className="mt-1 min-h-[44px]"
              value={snapshot.date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="notice-time" className={FIELD_LABEL}>
              {t('notice.fields.time')}
            </label>
            <Input
              id="notice-time"
              type="time"
              className="mt-1 min-h-[44px]"
              value={snapshot.time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>
        {!local ? (
          <Alert variant="notice" className="mt-3">
            {t('notice.fields.enterDateTime')}
          </Alert>
        ) : (
          readTime.disagrees && (
            <Alert variant="notice" className="mt-3">
              {t('notice.fields.checkDateTime')}
            </Alert>
          )
        )}
        <button
          onClick={onRetake}
          className="mt-3 min-h-[44px] inline-flex items-center text-sm text-ink-600 hover:text-ink-900 underline"
        >
          {t('appeal.tryDifferentPhoto')}
        </button>
      </Card>

      {local && (
        <section aria-labelledby="notice-matches-heading" className="mb-6">
          <h3 id="notice-matches-heading" className="font-display text-xl font-bold text-paper-50 mb-3">
            {t('notice.matches.heading')}
          </h3>
          {matches.length === 0 ? (
            <p className="text-sm leading-relaxed" style={{ color: '#A9CFBE' }}>
              {t('notice.matches.none')}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {matches.map((match) => {
                const session = records.find((r) => r.id === match.session_id)
                if (!session) return null
                const isSelected = selected?.session_id === match.session_id
                return (
                  <li key={match.session_id}>
                    <MatchCard
                      session={session}
                      match={match}
                      selected={isSelected}
                      now={now}
                      pdfBusy={pdfBusyId === session.id}
                      pdfFailed={isSelected && pdfFailed}
                      focusComparison={focusMatchId === match.session_id}
                      onComparisonFocused={() => setFocusMatchId(null)}
                      onSelect={() => {
                        setFocusMatchId(match.session_id)
                        onChange({ ...snapshot, selectedId: match.session_id })
                      }}
                      onDraftAppeal={() => onDraftAppeal(session, { ...snapshot, selectedId: match.session_id })}
                      onExportPdf={() => void exportPdf(session)}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {(!local || matches.length === 0) && (
        <Button className="w-full mb-6" onClick={() => onDraftAppeal(null, snapshot)}>
          {t('notice.actions.draftAnyway')}
        </Button>
      )}

      <p className="text-xs text-center leading-relaxed" style={{ color: '#A9CFBE' }}>
        {t('notice.disclaimer')}
      </p>
    </div>
  )
}

interface MatchCardProps {
  session: ParkingSession
  match: NoticeMatch
  selected: boolean
  now: number
  pdfBusy: boolean
  pdfFailed: boolean
  /** Move focus to the comparison heading once it shows (the driver just chose this card). */
  focusComparison: boolean
  onComparisonFocused: () => void
  onSelect: () => void
  onDraftAppeal: () => void
  onExportPdf: () => void
}

function MatchCard({
  session,
  match,
  selected,
  now,
  pdfBusy,
  pdfFailed,
  focusComparison,
  onComparisonFocused,
  onSelect,
  onDraftAppeal,
  onExportPdf,
}: MatchCardProps) {
  const { t } = useTranslation()
  const context = deviceRecordContext(session.id, now)
  const arrived = recordTimes(session, context).arrived_at
  const lines = selected ? noticeComparison(session, match, context) : []
  const headingId = `notice-match-${match.session_id}`
  const comparisonHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!selected || !focusComparison) return
    comparisonHeading.current?.focus()
    onComparisonFocused()
    // onComparisonFocused only clears the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, focusComparison])
  return (
    <Card pad="sm" as="div" className={selected ? 'ring-2 ring-[#7BE3A4]' : ''}>
      <p id={headingId} className="font-medium text-ink-900">
        {formatInZone(arrived, match.zone)}
      </p>
      {session.location?.address && <p className="text-xs text-ink-700 mt-0.5 break-words">{session.location.address}</p>}
      <p className="text-xs text-ink-600 mt-0.5 line-clamp-2">{session.no_sign ? t('history.noSignBadge') : session.rules}</p>
      {match.far && match.distance_m !== null && (
        <p className="text-xs text-accent-800 mt-2">
          {t('notice.match.far', { distance: Math.round(match.distance_m / 1000) })}
        </p>
      )}

      {!selected ? (
        <button
          onClick={onSelect}
          aria-describedby={headingId}
          className="mt-2 min-h-[44px] inline-flex items-center text-sm font-semibold text-brand-700 hover:text-brand-800 underline"
        >
          {t('notice.match.compare')}
        </button>
      ) : (
        <>
          {match.time_status !== 'normal' && (
            <p className="text-xs text-ink-700 mt-3 leading-relaxed">
              {t(match.time_status === 'repeated' ? 'notice.match.repeatedHour' : 'notice.match.skippedHour', {
                time: formatInZone(match.notice_at, match.zone),
              })}
            </p>
          )}
          <h4 ref={comparisonHeading} tabIndex={-1} className={`${FIELD_LABEL} mt-4 mb-2`}>
            {t('notice.compare.heading')}
          </h4>
          <ul className="flex flex-col gap-2" data-testid="notice-comparison">
            {lines.map((line) => (
              <li key={line.id} className="text-sm text-ink-800 leading-relaxed">
                {renderComparisonLine(line, t)}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 mt-4">
            <Button onClick={onDraftAppeal}>{t('notice.actions.draftAppeal')}</Button>
            <Button variant="outline" onClick={onExportPdf} disabled={pdfBusy}>
              {pdfBusy ? t('session.buildingPdf') : t('notice.actions.exportPdf')}
            </Button>
          </div>
          {pdfFailed && (
            <div role="alert" className="mt-3 text-sm">
              <p className="font-display font-bold text-ink-900 mb-1">{t('session.pdfErrorHeader')}</p>
              <p className="text-xs text-ink-700 leading-relaxed">{t('session.pdfErrorHelp')}</p>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
