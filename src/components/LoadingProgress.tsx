import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BrandMark from './BrandMark'

interface Stage {
  ms: number
  /** i18n key OR a literal English fallback for stages without locale keys. */
  labelKey: string
  /** When true, `labelKey` is a translation key; when false, it is the literal label. */
  translated: boolean
}

// Stage timing matches observed Sonnet 4.6 + adaptive + effort:low timings from
// CloudWatch (~12s end-to-end on a typical scan). Stages aren't lying — they
// describe what the model is actually doing at that phase of inference, just
// driven by a timer rather than real SSE because API Gateway HTTP API buffers.
const STAGES: Stage[] = [
  { ms: 0, labelKey: 'loading.step1', translated: true },
  { ms: 3000, labelKey: 'loading.step2', translated: true },
  { ms: 6500, labelKey: 'loading.step3', translated: true },
  { ms: 9500, labelKey: 'loading.step4', translated: true },
  { ms: 15000, labelKey: 'Almost there — this sign is complex…', translated: false },
  { ms: 22000, labelKey: 'Still working — taking longer than usual…', translated: false },
]

export default function LoadingProgress() {
  const { t } = useTranslation()
  const [stageIndex, setStageIndex] = useState(0)

  useEffect(() => {
    const timers = STAGES.slice(1).map((stage, i) =>
      setTimeout(() => setStageIndex(i + 1), stage.ms),
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  // Progress bar grows continuously toward "almost there" feel. Caps at 92%
  // so it never looks like we're stalling at 100% while waiting for the response.
  const visibleStages = STAGES.length - 1 // last stage is the "still working" fallback
  const progressPct = Math.min(92, ((stageIndex + 1) / visibleStages) * 92)

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <BrandMark className="w-24 h-24 mb-6 animate-pulse" />

      <p className="text-[10px] uppercase tracking-[0.18em] text-ink-500 mb-2 font-semibold">
        Step {Math.min(stageIndex + 1, visibleStages)} of {visibleStages}
      </p>

      <h2
        key={stageIndex}
        className="font-display text-2xl font-extrabold text-ink-900 max-w-xs animate-[fade-in_300ms_ease-out]"
      >
        {STAGES[stageIndex].translated
          ? t(STAGES[stageIndex].labelKey)
          : STAGES[stageIndex].labelKey}
      </h2>

      <div className="w-64 mt-8 h-1.5 bg-paper-300 rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-500 transition-[width] duration-700 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <p className="text-xs text-ink-500 mt-6">
        Usually takes about 10 seconds.
      </p>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  )
}
