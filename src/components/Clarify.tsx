import type { Clarification, RuleVariant } from '../types'

interface Props {
  signPhoto: string
  clarification: Clarification
  onPick: (variant: RuleVariant) => void
  onCancel: () => void
}

export default function Clarify({ signPhoto, clarification, onPick, onCancel }: Props) {
  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <button
        onClick={onCancel}
        className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4 transition-colors"
      >
        ← Back
      </button>

      <h2 className="font-display text-4xl font-extrabold text-ink-900 leading-tight">
        {clarification.question}
      </h2>

      <img
        src={signPhoto}
        alt="Scanned sign"
        className="w-full rounded-2xl mt-6 border border-paper-300 object-contain max-h-[32vh] bg-white"
      />

      <div className="flex flex-col gap-3 mt-6">
        {clarification.options.map((option, i) => (
          <button
            key={i}
            onClick={() => onPick(option)}
            className="bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white text-2xl font-bold py-6 rounded-2xl shadow-lg shadow-brand-500/20 transition-colors font-display tracking-tight"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
