import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SHARE_DECODE_ERROR_KEYS, decodeShareToken } from '../lib/share-link'
import { openShareLink, type OpenShareOptions, type ShareOpenResult, type ShareSaveStatus } from '../lib/share-receive'
import { useNow } from '../lib/use-now'
import SharedFactsPanel from './SharedFactsPanel'
import Icon from './Icon'
import Button from './ui/Button'
import BackButton from './ui/BackButton'

interface Props {
  /** The raw text after `#share=` (App reads it at startup and clears it from the address bar). */
  token: string
  /** Leave the view (home). */
  onDone: () => void
  /** Test hook: options for the check (trusted keys, development keys). */
  checkOptions?: OpenShareOptions
}

type Phase = { kind: 'checking' } | { kind: 'error'; key: string } | ShareOpenResult

const SAVED_KEYS: Readonly<Record<ShareSaveStatus, string>> = {
  created: 'share.saved',
  updated: 'share.saved',
  kept_newer: 'share.keptNewer',
  own_record: 'share.ownRecord',
  storage_full: 'errors.storageFull',
  failed: 'share.saveFailed',
}

/**
 * The receive view `shared` (build spec T7 items 3 and 4). Reads the link,
 * checks the sender's signed arrival with the in-browser verifier, and
 * only then shows the place, coordinates, arrival and expiry, all from the
 * signed payload, and keeps a read-only copy in History ("Shared with
 * you"). A link that doesn't check out shows "This link has been changed
 * since it was shared", with no details and no map link, and nothing is
 * kept. Never sets the page title or meta tags from the snapshot.
 */
export default function SharedLinkView({ token, onDone, checkOptions }: Props) {
  const { t } = useTranslation()
  const now = useNow()
  const decoded = useMemo(() => decodeShareToken(token), [token])
  const [phase, setPhase] = useState<Phase>(() =>
    decoded.ok ? { kind: 'checking' } : { kind: 'error', key: SHARE_DECODE_ERROR_KEYS[decoded.error] },
  )
  // The check (and the copy it keeps) runs once per link, StrictMode's
  // second effect run included; its result lands on the mounted view.
  const started = useRef<string | null>(null)
  const mounted = useRef(true)
  const options = useRef(checkOptions)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!decoded.ok || started.current === token) return
    started.current = token
    void openShareLink(decoded.payload, options.current).then((result) => {
      if (mounted.current) setPhase(result)
    })
  }, [decoded, token])

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton onClick={onDone}>{t('common.backToHome')}</BackButton>
      <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-4">{t('share.receivedTitle')}</h2>

      {phase.kind === 'checking' && (
        <p role="status" className="text-sm" style={{ color: '#A9CFBE' }}>
          {t('share.checking')}
        </p>
      )}

      {(phase.kind === 'error' || phase.kind === 'changed' || phase.kind === 'unreadable' || phase.kind === 'unavailable') && (
        <div role="alert" className="gf-card bg-white p-5 flex items-start gap-3">
          <Icon name="warning" className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-ink-900 leading-relaxed">
            {phase.kind === 'error'
              ? t(phase.key)
              : phase.kind === 'changed'
                ? t('share.tampered')
                : phase.kind === 'unavailable'
                  ? t('chain.checkUnavailable')
                  : t('share.unreadable')}
          </p>
        </div>
      )}

      {phase.kind === 'shown' && (
        <>
          <SharedFactsPanel facts={phase.facts} now={now} showDirections devKey={phase.outcome === 'dev_key'} />
          <p role="status" className="text-xs leading-relaxed mt-4" style={{ color: '#A9CFBE' }}>
            {t(SAVED_KEYS[phase.saved])}
          </p>
        </>
      )}

      <div className="mt-auto pt-6">
        <Button type="button" onClick={onDone} className="w-full min-h-[44px]">
          {t('common.done')}
        </Button>
      </div>
    </div>
  )
}
