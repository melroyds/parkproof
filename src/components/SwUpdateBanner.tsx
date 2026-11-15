import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import { dismissSwUpdate, subscribeSwUpdate, swUpdateAvailable } from '../lib/sw-update'

const GLASS = { background: 'rgba(255,255,255,0.055)' }

/**
 * "New version available": a new service worker installed over the one
 * running this page (src/lib/sw-update.ts watches for it from startup).
 * Refresh reloads the page, which the new version then serves.
 *
 * Home renders it in its own flow, above the install offers, and no other
 * screen does. A reload throws away whatever is on screen, and Home is the
 * one screen where a reload loses nothing: records, reminders and settings
 * are all stored. It used to float over every screen, fixed to the bottom,
 * where it covered each screen's bottom buttons, and a tap on Refresh there
 * lost a scan result, a record being logged or an appeal draft.
 *
 * A driver who never comes back to Home still gets the new version the next
 * time the app opens, because the service worker updates itself. Closing the
 * card hides it until the next update. Nothing is stored, so every new
 * version is offered.
 */
export default function SwUpdateBanner() {
  const { t } = useTranslation()
  const available = useSyncExternalStore(subscribeSwUpdate, swUpdateAvailable, () => false)

  if (!available) return null

  return (
    <div
      className="gf-card w-full mt-4 text-paper-50 min-h-[44px] flex items-center gap-3 pl-5 pr-1 py-1"
      style={GLASS}
    >
      <Icon name="bell" className="w-5 h-5 shrink-0 text-[#A9CFBE]" />
      <span className="font-medium flex-1 min-w-0 leading-snug">{t('swUpdate.available')}</span>
      <button
        type="button"
        // A plain reload is enough: the new worker is installed and takes
        // over (skipWaiting and clients.claim), so it serves the new shell.
        onClick={() => window.location.reload()}
        className="bg-paper-50 hover:bg-white active:bg-paper-100 text-brand-800 font-semibold rounded-full px-4 min-h-[44px] text-sm shrink-0 transition-colors"
      >
        {t('swUpdate.refresh')}
      </button>
      <button
        type="button"
        onClick={dismissSwUpdate}
        aria-label={t('common.close')}
        className="text-[#A9CFBE] hover:text-paper-50 leading-none text-lg min-w-[44px] min-h-[44px] inline-flex items-center justify-center shrink-0"
      >
        ×
      </button>
    </div>
  )
}
