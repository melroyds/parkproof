import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession, WorkdayState } from '../types'
import { isWorkdayEnabled } from '../lib/features'
import { formatInZone } from '../lib/time-format'
import { sessionTimezone } from '../lib/timezone'
import { useModalFocus } from '../lib/use-modal-focus'
import { chosenWorkdayLegs, stopNumber } from '../lib/workday-flow'
import Button from './ui/Button'

type PdfModule = typeof import('../lib/pdf-workday')

/** The workday PDF code, loaded once when the picker first opens (it carries jsPDF). */
let pdfModule: Promise<PdfModule> | null = null
function loadPdfModule(): Promise<PdfModule> {
  if (!pdfModule) {
    pdfModule = import('../lib/pdf-workday').catch((err: unknown) => {
      pdfModule = null
      throw err
    })
  }
  return pdfModule
}

interface Props {
  /** The workday's saved legs, in leg order (workdayLegs). */
  legs: ParkingSession[]
  /** The workday's state on this device, when it is here (its start and end go on the cover). */
  workday: WorkdayState | null
}

/**
 * "Export a PDF of this workday" on the workday view (build spec T6c item
 * 1): opens the leg picker, which shows the spec's warning before export
 * ("Councils can read it."), lists every leg ticked, and exports only the
 * legs left ticked. Renders nothing when workday mode is off in this build
 * (VITE_FEATURE_WORKDAY) or the workday has no legs.
 */
export default function WorkdayPdfExport({ legs, workday }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!isWorkdayEnabled() || legs.length === 0) return null
  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="w-full min-h-[44px] px-4 py-3 rounded-xl text-sm font-semibold text-paper-50 text-left transition-colors hover:bg-white/10"
        style={{ background: 'rgba(255,255,255,0.055)' }}
      >
        {t('workday.pdf.open')}
      </button>
      {open && <WorkdayPdfDialog legs={legs} workday={workday} onClose={() => setOpen(false)} />}
    </div>
  )
}

/**
 * The leg picker, modal as FeedbackModal: focus moves to the title and
 * stays inside, Escape and a tap outside close it (not while the PDF is
 * being built). Mounted only while open, so each open starts with every
 * leg ticked.
 */
function WorkdayPdfDialog({ legs, workday, onClose }: Props & { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const moduleRef = useRef<PdfModule | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(legs.map((l) => l.id)))
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const picked = chosenWorkdayLegs(legs, chosen)
  const close = () => {
    if (!busy) onClose()
  }
  useModalFocus(dialogRef, { initialFocus: titleRef, onEscape: close })

  // Load the PDF code and the locale's PDF font while the driver picks, so
  // the Export tap can build the file without waiting for either.
  useEffect(() => {
    let cancelled = false
    loadPdfModule()
      .then((mod) => {
        if (!cancelled) moduleRef.current = mod
      })
      .catch((err: unknown) => console.warn('[pdf] could not load the workday PDF code:', err))
    import('../lib/pdf-fonts')
      .then((mod) => mod.prefetchPdfFont(i18n.language))
      .catch((err: unknown) => console.warn('[pdf] could not load the PDF font:', err))
    return () => {
      cancelled = true
    }
    // The language is read once per open, as on the record screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleExport = async () => {
    if (busy || picked.length === 0) return
    setFailed(false)
    setBusy(true)
    let saved = false
    try {
      const mod = moduleRef.current ?? (await loadPdfModule())
      const { prefetchPdfFont } = await import('../lib/pdf-fonts')
      await prefetchPdfFont(i18n.language)
      // Cloud-synced photos arrive as URLs; jsPDF draws data URLs only.
      const forPdf = await mod.materializeRemotePhotosBatch(picked)
      saved = mod.downloadWorkdayPdf({ legs: forPdf, allLegs: legs, workday, t, locale: i18n.language })
    } catch (err) {
      console.error('[pdf] workday export failed:', err)
      setFailed(true)
    }
    setBusy(false)
    if (saved) onClose()
  }

  return (
    <div
      ref={dialogRef}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/60 backdrop-blur-sm safe-p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workday-pdf-title"
      aria-describedby="workday-pdf-warning"
    >
      <div className="bg-white gf-card max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2
          id="workday-pdf-title"
          ref={titleRef}
          tabIndex={-1}
          className="font-display text-2xl font-extrabold text-ink-900 outline-none"
        >
          {t('workday.pdf.title')}
        </h2>
        <p id="workday-pdf-warning" className="text-sm text-ink-700 leading-relaxed mt-2">
          {t('workday.pdf.warning')}
        </p>

        <fieldset className="mt-5">
          <legend className="text-xs uppercase tracking-widest font-semibold text-ink-600 mb-2">
            {t('workday.pdf.chooseLegs')}
          </legend>
          <ul className="flex flex-col gap-2">
            {legs.map((leg) => {
              const tz = sessionTimezone(leg.location)
              return (
                <li key={leg.id}>
                  <label className="flex items-start gap-3 min-h-[44px] p-3 rounded-xl border border-paper-300 cursor-pointer hover:border-brand-500">
                    <input
                      type="checkbox"
                      checked={chosen.has(leg.id)}
                      onChange={() => toggle(leg.id)}
                      disabled={busy}
                      className="mt-0.5 w-5 h-5 shrink-0 accent-brand-500"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-ink-900">{t('workday.pdf.leg', { number: stopNumber(leg) })}</span>
                      {leg.location?.address && (
                        <span className="block text-xs text-ink-700 mt-0.5 truncate">{leg.location.address}</span>
                      )}
                      <span className="block text-xs text-ink-600 mt-0.5">
                        {t('session.arrived', { when: formatInZone(leg.arrived_at, tz) })}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </fieldset>

        <p className="text-sm text-ink-700 mt-3 min-h-[1.25rem]" aria-live="polite">
          {picked.length === 0 ? t('workday.pdf.noneChosen') : ''}
        </p>

        {failed && (
          <div role="alert" className="mt-2 text-sm text-red-700">
            <p className="font-semibold">{t('session.pdfErrorHeader')}</p>
            <p className="mt-1">{t('session.pdfErrorHelp')}</p>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <Button type="button" onClick={handleExport} disabled={busy || picked.length === 0} className="w-full min-h-[44px]">
            {busy ? t('session.buildingPdf') : t('session.exportAsPdf')}
          </Button>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="w-full min-h-[44px] text-sm font-medium text-ink-700 hover:text-ink-900 rounded-xl disabled:opacity-60"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
