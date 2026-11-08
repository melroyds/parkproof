import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { showsPermitSafeguard } from '../lib/shared-record'
import Icon from './Icon'

/**
 * Build spec T7 item 6: on the share screen (and the handover screen), a
 * park that used an accessible parking permit warns that the permit stays
 * with its holder. Renders nothing for any other park, including resident
 * and business permits.
 */
export default function PermitSafeguardNote({ session, className = '' }: { session: Pick<ParkingSession, 'permit_context'>; className?: string }) {
  const { t } = useTranslation()
  if (!showsPermitSafeguard(session)) return null
  return (
    <div role="note" className={`bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5 flex items-start gap-2 ${className}`.trim()}>
      <Icon name="warning" className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
      <p className="text-sm text-amber-900 leading-relaxed">{t('share.permitSafeguard')}</p>
    </div>
  )
}
