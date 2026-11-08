import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { backupPromptShown, markBackupPromptShown, shouldOfferBackup } from '../lib/backup-prompt'
import { isIos, isStandalone } from '../lib/platform'
import { useModalFocus } from '../lib/use-modal-focus'
import { useLiveRecords } from '../lib/use-records-version'
import Icon from './Icon'
import Button from './ui/Button'

interface Props {
  /** False while sign-in is still resolving, so a signed-in driver is never asked. */
  enabled: boolean
  signedIn: boolean
  /** Sign-in is set up on this build: offer "Sign in to back up". */
  canSignIn: boolean
  onSignIn: () => void
}

/**
 * The one-time backup prompt (build spec T2, item 12). Shown once, after
 * the first photo of one of the driver's records is signed, while the
 * driver is neither signed in nor using ParkProof from the Home Screen: it
 * suggests either, because Safari can clear a site's data after 7 days
 * without a visit. Modal (FeedbackModal pattern): focus inside, Escape and
 * a tap outside close it.
 */
export default function BackupPrompt({ enabled, signedIn, canSignIn, onSignIn }: Props) {
  const sessions = useLiveRecords()
  const [shownBefore] = useState(backupPromptShown)
  const [standalone] = useState(isStandalone)
  const [closed, setClosed] = useState(false)
  const open = enabled && !closed && shouldOfferBackup({ sessions, signedIn, standalone, shown: shownBefore })

  // Shown once: remembered as soon as it is on screen.
  useEffect(() => {
    if (open) markBackupPromptShown()
  }, [open])

  if (!open) return null
  return <BackupDialog canSignIn={canSignIn} onClose={() => setClosed(true)} onSignIn={() => {
    setClosed(true)
    onSignIn()
  }} />
}

function BackupDialog({ canSignIn, onClose, onSignIn }: { canSignIn: boolean; onClose: () => void; onSignIn: () => void }) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useModalFocus(dialogRef, { initialFocus: titleRef, onEscape: onClose })
  return (
    <div
      ref={dialogRef}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink-900/60 backdrop-blur-sm safe-p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-title"
      aria-describedby="backup-body"
    >
      <div className="bg-white gf-card max-w-md w-full p-6 max-h-[min(90vh,100%)] overflow-y-auto">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
            <Icon name="warning" className="w-5 h-5" />
          </div>
          <h2
            id="backup-title"
            ref={titleRef}
            tabIndex={-1}
            className="font-display text-2xl font-extrabold text-ink-900 outline-none leading-tight"
          >
            {t('backupPrompt.title')}
          </h2>
        </div>
        <p id="backup-body" className="text-sm text-ink-700 leading-relaxed mt-3">
          {t('backupPrompt.body')}
        </p>
        <p className="text-sm text-ink-700 leading-relaxed mt-3">
          {isIos() ? t('backupPrompt.homeScreenIos') : t('backupPrompt.homeScreenOther')}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {canSignIn && (
            <Button type="button" onClick={onSignIn} className="w-full min-h-[44px]">
              {t('backupPrompt.signIn')}
            </Button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] text-sm font-medium text-ink-700 hover:text-ink-900 rounded-xl"
          >
            {t('backupPrompt.dismiss')}
          </button>
        </div>
      </div>
    </div>
  )
}
