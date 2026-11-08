import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import {
  CHAIN_KIND_KEYS,
  PHOTO_ROLE_KEYS,
  STORED_STATE_KEYS,
  chainCoversKey,
  chainFingerprint,
  chainRows,
  chainSummary,
  checkSummary,
  isSignedState,
  type ChainLinkKind,
} from '../lib/chain-view'
import { runChainCheck } from '../lib/chain-check'
import { getSession } from '../lib/storage'
import { arrivalSigningRejection } from '../lib/signing'
import { fetchRemotePhoto } from '../lib/session-photos'
import { materializePhotoFromCloud } from '../lib/sync'
import { formatInZone } from '../lib/time-format'
import type { LinkCheck, RecordVerification } from '../lib/verify'
import Icon from './Icon'

interface Props {
  /** The live record (the screen re-reads it on every records change). */
  session: ParkingSession
  /** The record's own time zone, for ParkProof's signing times. */
  timeZone: string
}

/** The verifier, loaded on the first check so the record screen doesn't carry it. */
type Verifier = typeof import('../lib/verify')

type Outcome =
  | { fingerprint: string; result: RecordVerification; verifier: Verifier }
  | { fingerprint: string; error: 'unavailable' | 'failed' }

const SAGE = '#A9CFBE'
const MINT = '#7BE3A4'
const GLASS = { background: 'rgba(255,255,255,0.055)' }

/**
 * The chain panel (T1a), under the vault signature panel on the record
 * screen: every signed part of the record (link 0, then each addendum),
 * what it covers, and ParkProof's signing time in the record's time zone.
 * Parts not signed yet read "Not signed yet", refused ones "This part
 * couldn't be signed", two signed parts at one place "Added from two
 * devices".
 *
 * Collapsed by default to one line ("3 parts signed"), so the record's
 * status stays near the top for a driver in a hurry. Opening it shows what
 * a signature does and doesn't show, the parts and "Check signatures".
 *
 * "Check signatures" runs the browser verifier (verify.ts) on this device,
 * through runChainCheck: photos whose bytes aren't here are first fetched
 * from the signed-in driver's cloud copy (a few at a time), and a part that
 * gets signed while the check runs is picked up by checking again. A
 * result that no longer describes the stored chain is replaced by "The
 * record changed after the check started". The verifier module is loaded
 * on the first check, not with the screen.
 */
export default function ChainPanel({ session, timeZone }: Props) {
  const { t } = useTranslation()
  const bodyId = useId()
  const [open, setOpen] = useState(false)
  const fingerprint = chainFingerprint(session)
  // Cheap, and read on every render: a link-0 refusal lives in the signing
  // state rather than on the record.
  const rows = chainRows(session, arrivalSigningRejection(session.id))
  const anySigned = rows.some((row) => isSignedState(row.state))
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [checking, setChecking] = useState(false)
  const current = outcome && outcome.fingerprint === fingerprint ? outcome : null
  // A result for a chain that has changed since: say so rather than show nothing.
  const stale = !checking && outcome !== null && 'result' in outcome && current === null
  const result = current && 'result' in current ? current.result : null
  const verifier = current && 'result' in current ? current.verifier : null

  const time = (iso: string | null) => (iso ? formatInZone(iso, timeZone) : '')

  const runCheck = async () => {
    if (checking) return
    setChecking(true)
    let mod: Verifier | null = null
    try {
      mod = await import('../lib/verify')
      const verify = mod.verifyRecord
      const checked = await runChainCheck(session, {
        verify: (s, options) => (options ? verify(s, options) : verify(s)),
        reread: () => getSession(session.id) ?? null,
        fetchRef: fetchRemotePhoto,
        fetchLegacy: materializePhotoFromCloud,
      })
      setOutcome({ fingerprint: checked.fingerprint, result: checked.result, verifier: mod })
    } catch (err) {
      console.warn('[verify] check failed:', err)
      setOutcome({
        fingerprint: chainFingerprint(getSession(session.id) ?? session),
        error: mod?.isVerifierUnavailable(err) ? 'unavailable' : 'failed',
      })
    } finally {
      setChecking(false)
    }
  }

  const heading = (kind: ChainLinkKind) => (
    <>
      <p className="text-sm font-display font-bold text-paper-50">{t(CHAIN_KIND_KEYS[kind])}</p>
      <p className="text-xs leading-relaxed" style={{ color: SAGE }}>
        {t(chainCoversKey(kind, session))}
      </p>
    </>
  )

  const line = (text: string, tone: 'plain' | 'good' | 'warn' = 'plain', key?: string): ReactNode => (
    <p key={key} className="text-xs leading-relaxed mt-1.5 flex items-start gap-1.5 text-paper-50">
      {tone === 'good' && <Icon name="check" className="w-3.5 h-3.5 mt-px shrink-0 text-[#7BE3A4]" strokeWidth={2.5} />}
      {tone === 'warn' && <Icon name="warning" className="w-3.5 h-3.5 mt-px shrink-0 text-amber-300" strokeWidth={2.25} />}
      <span>{text}</span>
    </p>
  )

  const checkedRow = (link: LinkCheck, v: Verifier): ReactNode[] => {
    const out: ReactNode[] = []
    if (link.status === 'dev_key') {
      // Its time line already says it is a development key, not ParkProof's.
      out.push(line(t('chain.devKeySignedAt', { time: time(link.signed_at) }), 'warn', 'time'))
    } else {
      if (link.status === 'valid') out.push(line(t('chain.signedAt', { time: time(link.signed_at) }), 'plain', 'time'))
      const tone = link.status === 'valid' ? 'good' : link.status === 'pending' ? 'plain' : 'warn'
      out.push(line(v.linkStatusText(link, t), tone, 'result'))
    }
    if (link.forked) out.push(line(v.forkText(t), 'warn', 'fork'))
    return out
  }

  const summary = result ? checkSummary(result) : null
  const collapsed = chainSummary(rows)

  return (
    <section className="mb-5">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
          className="w-full min-h-[44px] -my-1 py-1 flex items-center justify-between gap-3 text-left rounded-lg"
        >
          <span className="min-w-0">
            <span className="block text-xs uppercase tracking-widest font-semibold" style={{ color: SAGE }}>
              {t('chain.heading')}
            </span>
            <span className="block text-sm text-paper-50 mt-0.5">
              {collapsed.count !== undefined ? t(collapsed.key, { count: collapsed.count }) : t(collapsed.key)}
            </span>
          </span>
          <Icon
            name="chevron"
            className={`w-5 h-5 shrink-0 text-paper-50 transition-transform ${open ? 'rotate-180' : ''}`}
            strokeWidth={2.25}
          />
        </button>
      </h3>

      <div id={bodyId} hidden={!open} className="mt-3">
        <p className="text-xs leading-relaxed mb-3" style={{ color: SAGE }}>
          {t('chain.intro')}
        </p>
        <ol className="space-y-2">
          {result && verifier
            ? result.links.map((link, i) => (
                <li key={`${link.addendum_id ?? 'link-0'}:${i}`} className="gf-card px-4 py-3" style={GLASS}>
                  {heading(link.kind)}
                  {checkedRow(link, verifier)}
                </li>
              ))
            : rows.map((row) => (
                <li key={row.key} className="gf-card px-4 py-3" style={GLASS}>
                  {heading(row.kind)}
                  {line(
                    t(STORED_STATE_KEYS[row.state], { time: time(row.signed_at) }),
                    row.state === 'rejected' ? 'warn' : 'plain',
                  )}
                  {row.forked && line(t('verifier.fork'), 'warn')}
                </li>
              ))}
        </ol>

        {/* Nothing to check until a part is signed. */}
        {anySigned && (
          <button
            type="button"
            onClick={() => void runCheck()}
            disabled={checking}
            className="mt-3 w-full min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/15 disabled:opacity-60 text-paper-50 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
          >
            <Icon name="check" className="w-4 h-4" strokeWidth={2.5} />
            {checking ? t('chain.checking') : t('chain.check')}
          </button>
        )}

        <div role="status" aria-live="polite">
          {stale && <p className="text-xs leading-relaxed mt-3 text-amber-300">{t('chain.checkChanged')}</p>}
          {current && 'error' in current && (
            <p className="text-xs leading-relaxed mt-3 text-amber-300">
              {current.error === 'unavailable' ? t('chain.checkUnavailable') : t('chain.checkFailed')}
            </p>
          )}
          {result && verifier && summary && (
            <div className="mt-3">
              <p
                className="text-sm leading-relaxed font-semibold"
                style={{
                  color:
                    result.overall === 'valid' && summary.key === 'chain.checkValid'
                      ? MINT
                      : result.overall === 'valid' || result.overall === 'unsigned'
                        ? SAGE
                        : '#FCD34D',
                }}
              >
                {summary.count !== undefined ? t(summary.key, { count: summary.count }) : t(summary.key)}
              </p>
              {result.photos.length > 0 && (
                <>
                  <h4 className="text-xs uppercase tracking-widest font-semibold mt-4 mb-2" style={{ color: SAGE }}>
                    {t('chain.photosHeading')}
                  </h4>
                  <ul className="space-y-2">
                    {result.photos.map((photo) => (
                      <li key={`${photo.role}/${photo.sha256}`} className="gf-card px-4 py-3" style={GLASS}>
                        <p className="text-sm font-display font-bold text-paper-50">{t(PHOTO_ROLE_KEYS[photo.role])}</p>
                        {line(
                          verifier.photoStatusText(photo, t),
                          photo.status === 'matches' ? 'good' : photo.status === 'differs' ? 'warn' : 'plain',
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
