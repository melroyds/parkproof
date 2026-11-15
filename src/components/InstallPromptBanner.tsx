import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import {
  dismissInstallOffer,
  installOfferAvailable,
  promptInstall,
  subscribeInstallOffer,
} from '../lib/install-offer'

const GLASS = { background: 'rgba(255,255,255,0.055)' }

/**
 * "Install ParkProof" on Android Chrome, Edge and Samsung Internet: the
 * browser's own install dialog behind a clearly branded offer
 * (src/lib/install-offer.ts catches the browser's event from startup).
 *
 * Home renders it in its own flow, under the menu. It used to float over
 * every screen, fixed to the bottom, where it covered each screen's bottom
 * buttons (Translate, Done) until it was closed.
 *
 * iOS Safari never fires the event; IosInstallHint covers it.
 */
export default function InstallPromptBanner() {
  const { t } = useTranslation()
  const available = useSyncExternalStore(subscribeInstallOffer, installOfferAvailable, () => false)
  const [installing, setInstalling] = useState(false)

  if (!available) return null

  const install = async () => {
    if (installing) return
    setInstalling(true)
    try {
      await promptInstall()
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div
      className="gf-card w-full mt-4 text-paper-50 min-h-[44px] flex items-center gap-3 pl-5 pr-1 py-1"
      style={GLASS}
    >
      <Icon name="bell" className="w-5 h-5 shrink-0 text-[#A9CFBE]" />
      <span className="font-medium flex-1 min-w-0 leading-snug">{t('installPrompt.available')}</span>
      <button
        type="button"
        onClick={install}
        disabled={installing}
        className="bg-paper-50 hover:bg-white active:bg-paper-100 disabled:opacity-50 text-brand-800 font-semibold rounded-full px-4 min-h-[44px] text-sm shrink-0 transition-colors"
      >
        {installing ? t('installPrompt.installing') : t('installPrompt.install')}
      </button>
      <button
        type="button"
        onClick={dismissInstallOffer}
        aria-label={t('common.close')}
        className="text-[#A9CFBE] hover:text-paper-50 leading-none text-lg min-w-[44px] min-h-[44px] inline-flex items-center justify-center shrink-0"
      >
        ×
      </button>
    </div>
  )
}
