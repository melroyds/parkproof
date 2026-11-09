import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { ParkingSession, PhotoRef } from '../types'
import { PHOTO_ROLE_KEYS } from '../lib/chain-view'
import {
  COMPLIANCE_TYPE_KEYS,
  conditionNotes,
  evidencePhotos,
  photoSigning,
  type EvidenceGroup,
  type EvidencePhoto,
  type PartSigning,
  type PhotoSigning,
} from '../lib/evidence-photos'
import { shortFingerprint } from '../lib/session-photos'
import { formatInZone } from '../lib/time-format'
import { useRefPhoto } from '../lib/use-session-photo'
import Icon from './Icon'
import Card from './ui/Card'

interface Props {
  /** The live record. */
  session: ParkingSession
  /** The record's own time zone. */
  timeZone: string
}

const GROUPS: readonly EvidenceGroup[] = ['parking', 'return', 'compliance']

const GROUP_KEYS: Readonly<Record<EvidenceGroup, string>> = {
  parking: 'evidence.group.parking',
  return: 'evidence.group.return',
  compliance: 'evidence.group.compliance',
}

/**
 * The record's condition and proof photos (build spec T2, item 7): the
 * photos of the car when parked and on return, and the proof of payment or
 * permit. Each shows when it was added (phone clock), its short
 * fingerprint, whether ParkProof has signed it, and the library label when
 * it came from the photo library. A photo whose bytes aren't on this device
 * shows the one "not on this device" state with its fingerprint (N4). The
 * driver's damage notes and proof types are shown as their own words, and
 * a note that isn't signed says so (N2).
 */
export default function EvidencePhotos({ session, timeZone }: Props) {
  const { t } = useTranslation()
  const photos = evidencePhotos(session)
  const notes = conditionNotes(session)
  if (photos.length === 0 && notes.length === 0) return null
  return (
    <Card className="mb-3 rounded-2xl border-transparent shadow-[0_14px_40px_rgba(7,59,37,0.16),0_2px_6px_rgba(7,59,37,0.08)]">
      {GROUPS.map((group) => {
        const inGroup = photos.filter((p) => p.group === group)
        const groupNotes = group === 'compliance' ? [] : notes.filter((n) => n.when === group)
        if (inGroup.length === 0 && groupNotes.length === 0) return null
        return (
          <section key={group} className="mb-5 last-of-type:mb-0">
            <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-600 mb-2">{t(GROUP_KEYS[group])}</h3>
            {inGroup.length > 0 && (
              <ul className="space-y-4">
                {inGroup.map((photo) => (
                  <EvidencePhotoItem
                    key={`${photo.ref.role}/${photo.ref.sha256}`}
                    session={session}
                    photo={photo}
                    timeZone={timeZone}
                  />
                ))}
              </ul>
            )}
            {groupNotes.map((note, i) => {
              const state = noteStateText(note.state, t)
              return (
                <div key={i} className="mt-3">
                  <p className="text-xs font-semibold text-ink-600">{t('evidence.noteLabel')}</p>
                  <p className="text-sm text-ink-900 whitespace-pre-wrap break-words leading-relaxed">{note.note}</p>
                  {state && <p className="text-xs text-ink-600 mt-0.5 leading-relaxed">{state}</p>}
                </div>
              )
            })}
          </section>
        )
      })}
      <p className="text-xs text-ink-600 mt-4 leading-relaxed">{t('photoGrid.signedNote')}</p>
    </Card>
  )
}

function EvidencePhotoItem({ session, photo, timeZone }: { session: ParkingSession; photo: EvidencePhoto; timeZone: string }) {
  const { t } = useTranslation()
  const bytes = useRefPhoto(session, photo.ref.sha256)
  const roleLabel = t(PHOTO_ROLE_KEYS[photo.ref.role])
  return (
    <li>
      {bytes.status === 'loading' && (
        <div className="w-full h-40 rounded-xl border border-paper-300 bg-paper-100" aria-hidden="true" />
      )}
      {bytes.status === 'available' && (
        <img src={bytes.src} alt={roleLabel} className="w-full max-h-64 object-contain bg-paper-100 rounded-xl border border-paper-300" />
      )}
      {bytes.status === 'missing' && <MissingBytes sha256={photo.ref.sha256} signing={photo.signing} />}
      <p className="text-sm font-semibold text-ink-900 mt-2">
        {roleLabel}
        {photo.compliance_type && (
          <span className="font-normal text-ink-700">
            {' · '}
            {t('evidence.complianceDescribed', { type: t(COMPLIANCE_TYPE_KEYS[photo.compliance_type]) })}
          </span>
        )}
      </p>
      <PhotoRefMeta photoRef={photo.ref} signing={photo.signing} timeZone={timeZone} showFingerprint={bytes.status !== 'missing'} />
    </li>
  )
}

/**
 * The line under a damage note whose part isn't signed: waiting, refused,
 * or in no part at all. Null for a signed note (its signing time is in the
 * chain panel).
 */
function noteStateText(state: PartSigning, t: TFunction): string | null {
  switch (state) {
    case 'pending':
      return t('verifier.link.pending')
    case 'rejected':
      return t('verifier.link.rejected')
    case 'unsigned':
      return t('evidence.noteNotSigned')
    default:
      return null
  }
}

/** The one bytes-missing state (N4), worded for where the photo's fingerprint stands. */
function MissingBytes({ sha256, signing }: { sha256: string; signing: PhotoSigning }) {
  const { t } = useTranslation()
  const fingerprint = shortFingerprint(sha256)
  const text =
    signing.state === 'signed'
      ? t('session.photoNotOnDevice', { fingerprint })
      : signing.state === 'dev_key'
        ? t('verifier.photo.notOnDeviceDevKey', { fingerprint })
        : signing.state === 'pending'
          ? t('session.photoNotOnDeviceUnsigned', { fingerprint })
          : t('evidence.photoNotOnDevice', { fingerprint })
  return (
    <p className="flex items-start gap-2 text-xs text-ink-700 bg-paper-100 border border-paper-300 rounded-xl p-3 leading-relaxed">
      <Icon name="warning" className="w-4 h-4 shrink-0 mt-0.5 text-ink-600" />
      <span>{text}</span>
    </p>
  )
}

/**
 * The lines under a photo: when it was added (phone clock), its short
 * fingerprint, where its signature stands, and, for a photo from the photo
 * library, that the signature shows the photo existed by ParkProof's
 * signing time, not when it was taken. `signing` defaults to the record's
 * own state for the photo.
 */
export function PhotoRefMeta({
  photoRef,
  timeZone,
  session,
  signing,
  showFingerprint = true,
  showSigning = true,
}: {
  photoRef: PhotoRef
  timeZone: string
  session?: ParkingSession
  signing?: PhotoSigning
  showFingerprint?: boolean
  showSigning?: boolean
}) {
  const { t } = useTranslation()
  const state = signing ?? (session ? photoSigning(session, photoRef.sha256) : null)
  const time = (iso: string | null) => (iso ? formatInZone(iso, timeZone) : '')
  return (
    <div className="mt-1 space-y-0.5 text-xs text-ink-600 leading-relaxed">
      <p className="tnum">{t('evidence.addedAt', { time: time(photoRef.captured_at) })}</p>
      {showFingerprint && (
        <p className="font-mono">{t('evidence.fingerprint', { fingerprint: shortFingerprint(photoRef.sha256) })}</p>
      )}
      {showSigning && state && (
        <p>
          {state.state === 'signed'
            ? t('chain.signedAt', { time: time(state.signed_at) })
            : state.state === 'dev_key'
              ? t('chain.devKeySignedAt', { time: time(state.signed_at) })
              : state.state === 'pending'
                ? t('verifier.link.pending')
                : state.state === 'rejected'
                  ? t('verifier.link.rejected')
                  : t('evidence.notSigned')}
        </p>
      )}
      {photoRef.source === 'library' && <p className="text-ink-700">{t('evidence.library')}</p>}
    </div>
  )
}
