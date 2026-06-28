import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { submitUserFeedback } from '../lib/user-feedback'
import type { UserFeedbackContext } from '../lib/user-feedback'

interface Props {
  open: boolean
  onClose: () => void
  /** Auto-attached to every submission — lets you slice by view, locale, etc. */
  context?: UserFeedbackContext
}

const MAX_LEN = 5000

/**
 * Modal for free-text feedback. Opens from a footer link on the home screen.
 * Submits to /user-feedback (Lambda → CloudWatch + S3 mirror).
 *
 * The stateful body lives in a child that only mounts while open, so each open
 * starts with fresh state — no reset-on-open effect (which would call setState
 * synchronously inside an effect, the pattern the react-hooks lint rule flags).
 */
export default function FeedbackModal({ open, onClose, context }: Props) {
  if (!open) return null
  return <FeedbackModalBody onClose={onClose} context={context} />
}

/**
 * UX choices:
 *   - Email is optional; user can submit anonymously
 *   - Character counter shows when near the cap; otherwise hidden
 *   - On success, transitions to a thank-you state for 2 seconds, then closes
 *   - On error, shows the message inline and keeps the form populated so the
 *     user can retry without retyping
 *   - Esc closes when not loading; closes after success-state delay
 *   - Backdrop click closes (same rules)
 */
function FeedbackModalBody({
  onClose,
  context,
}: {
  onClose: () => void
  context?: UserFeedbackContext
}) {
  const { t, i18n } = useTranslation()
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus the textarea after the modal mounts. setTimeout lets layout settle.
  useEffect(() => {
    const id = setTimeout(() => textareaRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [])

  // Focus trap + restore. Capture whatever was focused when the body mounted,
  // keep Tab/Shift+Tab cycling within the dialog, and restore focus to the
  // opener on unmount. No setState here — purely DOM focus management.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null

    function focusables(): HTMLElement[] {
      const root = dialogRef.current
      if (!root) return []
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
    }

    function onTrapKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const els = focusables()
      if (els.length === 0) return
      const first = els[0]
      const last = els[els.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !dialogRef.current?.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !dialogRef.current?.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener('keydown', onTrapKey)
    return () => {
      window.removeEventListener('keydown', onTrapKey)
      opener?.focus?.()
    }
  }, [])

  // Esc-to-close. Don't close while submitting; the success state closes itself
  // on a delay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting && !success) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submitting, success, onClose])

  // Auto-close after success — 2 second pause to read the thank-you copy.
  useEffect(() => {
    if (!success) return
    const id = setTimeout(onClose, 2000)
    return () => clearTimeout(id)
  }, [success, onClose])

  const trimmedLen = message.trim().length
  const canSubmit = trimmedLen > 0 && trimmedLen <= MAX_LEN && !submitting
  const showCounter = message.length >= MAX_LEN * 0.8

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const fullContext: UserFeedbackContext = {
        user_agent:
          typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        locale: i18n.language,
        ...context,
      }
      await submitUserFeedback({
        message,
        email: email || null,
        context: fullContext,
      })
      setSuccess(true)
    } catch (err) {
      // Never surface the raw server/SDK detail (a 500 can carry "API 500: ...").
      // The curated generic line covers every failure on this low-stakes form.
      console.error('[feedback] submit failed:', err)
      setError(t('feedback.error.generic'))
      setSubmitting(false)
    }
  }

  function onBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    // Only close on direct backdrop click — not when a click inside the
    // modal bubbles up.
    if (e.target === e.currentTarget && !submitting && !success) {
      onClose()
    }
  }

  return (
    <div
      ref={dialogRef}
      onMouseDown={onBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {success ? (
          <div className="p-8 text-center">
            <div
              className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 text-2xl mb-4"
              aria-hidden="true"
            >
              ✓
            </div>
            <h2
              id="feedback-title"
              className="font-display text-2xl font-extrabold text-ink-900 mb-2"
            >
              {t('feedback.successTitle')}
            </h2>
            <p className="text-sm text-ink-700 leading-relaxed">
              {t('feedback.successBody')}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 sm:p-8">
            <div className="flex items-start justify-between mb-2">
              <h2
                id="feedback-title"
                className="font-display text-2xl font-extrabold text-ink-900"
              >
                {t('feedback.title')}
              </h2>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="text-ink-500 hover:text-ink-800 disabled:opacity-50 -mt-1 -mr-1 p-2 text-xl leading-none min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label={t('common.close')}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <p className="text-sm text-ink-600 mb-5 leading-relaxed">
              {t('feedback.intro')}
            </p>

            <label
              htmlFor="feedback-message"
              className="block text-xs font-semibold text-ink-700 mb-1"
            >
              {t('feedback.messageLabel')}
              <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            <textarea
              id="feedback-message"
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
              disabled={submitting}
              placeholder={t('feedback.messagePlaceholder')}
              rows={6}
              className="w-full border border-paper-300 rounded-lg px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 disabled:bg-paper-50 disabled:opacity-60 resize-none"
              maxLength={MAX_LEN}
              aria-required="true"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'feedback-error' : undefined}
            />
            {showCounter && (
              <p className="text-xs text-ink-500 text-right mt-1">
                {message.length} / {MAX_LEN}
              </p>
            )}

            <label
              htmlFor="feedback-email"
              className="block text-xs font-semibold text-ink-700 mb-1 mt-4"
            >
              {t('feedback.emailLabel')}
              <span className="text-ink-500 font-normal ml-1">{t('feedback.emailOptional')}</span>
            </label>
            <input
              id="feedback-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              placeholder={t('feedback.emailPlaceholder')}
              className="w-full border border-paper-300 rounded-lg px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 disabled:bg-paper-50 disabled:opacity-60"
              maxLength={254}
            />
            <p className="text-xs text-ink-500 mt-1 leading-relaxed">
              {t('feedback.emailHelp')}
            </p>

            {error && (
              <div
                id="feedback-error"
                role="alert"
                className="mt-4 bg-red-50 border border-red-200 text-red-900 text-sm rounded-lg px-3 py-2"
              >
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-ink-700 hover:text-ink-900 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-5 py-2 bg-gradient-to-r from-brand-500 via-brand-500 to-purple-600 hover:brightness-110 active:brightness-95 disabled:bg-none disabled:bg-paper-300 disabled:text-ink-500 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {submitting ? t('feedback.sending') : t('feedback.send')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
