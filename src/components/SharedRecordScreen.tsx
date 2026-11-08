import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { sharedFactsOfCopy, shareOutcome } from '../lib/shared-record'
import { DEV_KEY_ALIAS } from '../lib/evidence-chain'
import type { TrustedKey } from '../lib/verify'
import { useLiveRecord } from '../lib/use-records-version'
import { useNow } from '../lib/use-now'
import SharedFactsPanel from './SharedFactsPanel'
import Icon from './Icon'
import Button from './ui/Button'
import BackButton from './ui/BackButton'

interface Props {
  /** A read-only copy from a share link (`shared_from` set). */
  session: ParkingSession
  onBack: () => void
  /** "Remove", after its confirm. App owns the delete. */
  onRemove: (session: ParkingSession) => void
  /** Test hook: keys to trust instead of ParkProof's published key. */
  publicKeys?: readonly TrustedKey[]
  /** Test hook: accept a development-key bundle (default: development builds only). */
  acceptDevKey?: boolean
}

type CheckState = 'checking' | 'valid' | 'dev_key' | 'changed' | 'unavailable' | 'failed'

const CHECK_KEYS: Readonly<Record<Exclude<CheckState, 'checking'>, string>> = {
  valid: 'share.checkValid',
  dev_key: 'verifier.link.devKey',
  changed: 'share.tampered',
  unavailable: 'chain.checkUnavailable',
  failed: 'chain.checkFailed',
}

/**
 * The record screen of a read-only shared copy (build spec T7 item 4):
 * the countdown, Directions, "Check the signature" and Remove, with the
 * snapshot banner and the sender's extras labelled as theirs. No I've
 * left, photos, reminders, handover, share or appeal: it is someone
 * else's record.
 */
export default function SharedRecordScreen({ session: initial, onBack, onRemove, publicKeys, acceptDevKey }: Props) {
  const { t } = useTranslation()
  const session = useLiveRecord(initial)
  const now = useNow()
  const facts = useMemo(() => sharedFactsOfCopy(session), [session])
  // Keyed by the bundle checked, so a copy updated by a newer link isn't
  // shown with the old copy's result.
  const bundleKey = session.shared_from?.arrival_bundle?.signature_base64 ?? ''
  const [check, setCheck] = useState<{ key: string; state: CheckState } | null>(null)
  const result = check && check.key === bundleKey ? check.state : null

  const runCheck = async () => {
    const from = session.shared_from
    if (!from) return
    setCheck({ key: bundleKey, state: 'checking' })
    let state: CheckState
    let verifier: typeof import('../lib/verify') | null = null
    try {
      // Loaded on the tap, as the chain panel loads it: its own chunk.
      verifier = await import('../lib/verify')
      const link = await verifier.verifyArrivalBundle(from.arrival_bundle, {
        sessionId: from.original_session_id,
        publicKeys,
      })
      state = shareOutcome(link, acceptDevKey)
    } catch (err) {
      state = verifier?.isVerifierUnavailable(err) ? 'unavailable' : 'failed'
      if (state === 'failed') console.warn('[share] the copy could not be checked:', err)
    }
    setCheck({ key: bundleKey, state })
  }

  const remove = () => {
    if (!window.confirm(t('share.removeConfirm'))) return
    onRemove(session)
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton onClick={onBack}>{t('common.backToHistory')}</BackButton>
      <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-4">{t('share.badge')}</h2>

      {facts ? (
        <SharedFactsPanel
          facts={facts}
          now={now}
          // A copy whose signature failed its check keeps no map link.
          showDirections={result !== 'changed'}
          devKey={session.shared_from?.arrival_bundle?.key_alias === DEV_KEY_ALIAS}
        />
      ) : (
        <div role="alert" className="gf-card bg-white p-5 flex items-start gap-3">
          <Icon name="warning" className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-ink-900 leading-relaxed">{t('share.unreadable')}</p>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {facts && (
          <Button variant="outline" type="button" onClick={() => void runCheck()} disabled={result === 'checking'}>
            {result === 'checking' ? t('chain.checking') : t('share.check')}
          </Button>
        )}
        {result && result !== 'checking' && (
          <p
            role="status"
            className={`text-sm leading-relaxed px-1 ${result === 'valid' ? 'text-[#7BE3A4]' : 'text-paper-50 font-semibold'}`}
          >
            {t(CHECK_KEYS[result])}
          </p>
        )}
        {/* Destructive, so the danger style: coral on the vault, quieter
            than Check the signature (WCAG AA, Button's danger variant). */}
        <Button variant="danger" size="sm" type="button" onClick={remove}>
          {t('share.remove')}
        </Button>
      </div>
    </div>
  )
}
