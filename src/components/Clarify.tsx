import { useTranslation } from 'react-i18next'
import type { Clarification, RuleVariant } from '../types'
import BackButton from './ui/BackButton'

interface Props {
  signPhoto: string
  clarification: Clarification
  onPick: (variant: RuleVariant) => void
  onCancel: () => void
}

export default function Clarify({ signPhoto, clarification, onPick, onCancel }: Props) {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton onClick={onCancel}>
        {t('common.back')}
      </BackButton>

      <h2 className="font-display text-4xl font-extrabold text-paper-50 leading-tight">
        {clarification.question}
      </h2>

      <img
        src={signPhoto}
        alt={t('clarify.imageAlt')}
        className="w-full rounded-lg mt-6 border border-brand-900/10 object-contain max-h-[32vh] bg-white"
      />

      <div className="flex flex-col gap-3 mt-6">
        {clarification.options.map((option, i) => (
          <button
            key={i}
            onClick={() => onPick(option)}
            className="bg-white hover:bg-brand-50 border-2 border-brand-600 hover:border-brand-700 text-brand-700 text-2xl font-bold py-6 rounded-xl transition-colors font-display tracking-tight"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
