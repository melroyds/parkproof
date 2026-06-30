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

      <p className="text-2xs uppercase tracking-[0.18em] mb-2 font-semibold inline-flex items-center gap-1.5" style={{ color: '#A9CFBE' }}>
        {/* Pulsing dot inline with the step counter — subtle liveness signal
            for a screen that otherwise updates only every ~3 seconds when
            the stage advances. The dot's "ping" expansion echoes outwards
            and fades, giving the user a sense of "something is still
            happening" between stage transitions. */}
        <span className="relative flex w-1.5 h-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-75 animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite]" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-500" />
        </span>
        Step {Math.min(stageIndex + 1, visibleStages)} of {visibleStages}
      </p>

      <h2
        key={stageIndex}
        role="status"
        aria-live="polite"
        className="font-display text-2xl font-extrabold text-paper-50 max-w-xs animate-[fade-in_300ms_ease-out]"
      >
        {STAGES[stageIndex].translated
          ? t(STAGES[stageIndex].labelKey)
          : STAGES[stageIndex].labelKey}
      </h2>

      {/* Progress bar — base fill grows toward 92% over the stage timeline.
          The shimmer overlay (the moving lighter band) sweeps continuously
          left-to-right INSIDE the filled portion, so the bar reads as
          actively progressing rather than a static line that occasionally
          jumps. Psychological "slow feels faster" win, courtesy of every
          loading skeleton library written since 2018. */}
      <div
        role="progressbar"
        aria-valuenow={Math.round(progressPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="w-64 mt-8 h-1.5 bg-white/10 rounded-full overflow-hidden relative"
      >
        <div
          className="h-full bg-brand-500 transition-[width] duration-700 ease-out relative overflow-hidden"
          style={{ width: `${progressPct}%` }}
        >
          {/* The shimmer band — a soft white-to-transparent gradient that
              moves across the filled portion. -translate-x-full at start,
              translate-x-full at end, infinite loop. Reduced-motion users
              get the static base bar courtesy of the global media query
              in index.css. */}
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        </div>
      </div>

      <p role="status" aria-live="polite" className="text-xs mt-6" style={{ color: '#A9CFBE' }}>
        Usually takes about 10 seconds.
      </p>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </main>
  )
}
