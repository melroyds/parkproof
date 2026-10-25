import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession, PhotoRole } from '../types'
import { useSessionPhoto } from '../lib/use-session-photo'
import { hasSessionPhoto, shortFingerprint } from '../lib/session-photos'
import Icon from './Icon'

interface Props {
  session: ParkingSession
  role: PhotoRole
  alt: string
  className?: string
}

/**
 * One photo of a record, read through the photo store for new records
 * (legacy fields for old ones). Renders nothing when the record has no
 * photo for the role, a quiet placeholder while the bytes load, and the
 * one "bytes missing" state when they aren't on this device.
 */
export default function RecordPhoto({ session, role, alt, className }: Props) {
  const photo = useSessionPhoto(session, role)
  if (photo.status === 'none') return null
  if (photo.status === 'loading') {
    return <div className="w-full h-40 rounded-xl border border-paper-300 bg-paper-100" aria-hidden="true" />
  }
  if (photo.status === 'missing') return <PhotoMissingNote sha256={photo.sha256} signed={photo.signed} />
  return <img src={photo.src} alt={alt} className={className} />
}

/**
 * A small decorative thumbnail: the record's first photo among `roles`
 * (in that order) that it has at all. `fallback` shows while it loads,
 * when the record has none of them, and when the bytes aren't on this
 * device (a thumbnail is too small for the fingerprint line; the record
 * screen shows it).
 */
export function RecordThumbnail({
  session,
  roles,
  className,
  fallback,
}: {
  session: ParkingSession
  roles: readonly PhotoRole[]
  className?: string
  fallback: ReactNode
}) {
  const role = roles.find((r) => hasSessionPhoto(session, r)) ?? roles[0]
  const photo = useSessionPhoto(session, role)
  if (photo.status !== 'available') return <>{fallback}</>
  return <img src={photo.src} alt="" className={className} />
}

/**
 * "Photo not on this device. Signed fingerprint 3f9a…c21b." The fingerprint
 * is only called signed when it is inside a stored ParkProof signature.
 */
export function PhotoMissingNote({ sha256, signed }: { sha256: string; signed: boolean }) {
  const { t } = useTranslation()
  const fingerprint = shortFingerprint(sha256)
  return (
    <p className="flex items-start gap-2 text-xs text-ink-700 bg-paper-100 border border-paper-300 rounded-xl p-3 leading-relaxed">
      <Icon name="warning" className="w-4 h-4 shrink-0 mt-0.5 text-ink-600" />
      <span>
        {signed
          ? t('session.photoNotOnDevice', { fingerprint })
          : t('session.photoNotOnDeviceUnsigned', { fingerprint })}
      </span>
    </p>
  )
}
