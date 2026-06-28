import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  confirmForgotPassword,
  confirmSignUp,
  forgotPassword,
  resendConfirmationCode,
  signIn,
  signUp,
} from '../lib/auth'
import { federationConfigured, redirectToProvider } from '../lib/federated-auth'
import { useAuth } from '../lib/use-auth'
import BrandMark from './BrandMark'

interface Props {
  onDone: () => void
  onCancel: () => void
}

type Stage =
  | { name: 'sign-in' }
  | { name: 'sign-up' }
  | { name: 'verify'; email: string; password: string | null }
  | { name: 'forgot' }
  | { name: 'reset'; email: string }

export default function AuthFlow({ onDone, onCancel }: Props) {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const [stage, setStage] = useState<Stage>({ name: 'sign-in' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const resetForms = () => {
    setError(null)
    setInfo(null)
    setBusy(false)
  }

  const goTo = (next: Stage) => {
    resetForms()
    setCode('')
    setStage(next)
  }

  // Map raw Cognito exceptions to friendly, translated copy. The error name may
  // live on err.name, err.__type, or be embedded in err.message.
  const friendlyError = (err: unknown): string => {
    const name = err instanceof Error ? err.name : ''
    const type =
      typeof err === 'object' && err !== null && '__type' in err
        ? String((err as { __type?: unknown }).__type ?? '')
        : ''
    const message = err instanceof Error ? err.message : String(err)
    const haystack = `${name} ${type} ${message}`

    if (/NotAuthorizedException/i.test(haystack)) return t('auth.errWrongCredentials')
    if (/UsernameExistsException/i.test(haystack)) return t('auth.errAccountExists')
    if (/LimitExceededException|TooManyRequestsException/i.test(haystack))
      return t('auth.errTooManyAttempts')
    if (/CodeMismatchException/i.test(haystack)) return t('auth.errCodeMismatch')
    if (/ExpiredCodeException/i.test(haystack)) return t('auth.errCodeExpired')
    if (/UserNotFoundException/i.test(haystack)) return t('auth.errUserNotFound')
    return t('auth.errGeneric')
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
      await refresh()
      onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const errName = err instanceof Error ? err.name : ''
      if (/not confirmed|UserNotConfirmedException/i.test(`${errName} ${msg}`)) {
        // Resume the verify flow if they signed up but never verified.
        setInfo(t('auth.needVerifyFirst'))
        setStage({ name: 'verify', email: email.trim(), password })
      } else {
        setError(friendlyError(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signUp(email.trim(), password)
      setInfo(t('auth.accountCreated'))
      setStage({ name: 'verify', email: email.trim(), password })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (stage.name !== 'verify') return
    setBusy(true)
    setError(null)
    try {
      await confirmSignUp(stage.email, code.trim())
      // Auto-sign-in if we still have the password from the sign-up form.
      if (stage.password) {
        await signIn(stage.email, stage.password)
        await refresh()
        onDone()
      } else {
        setInfo(t('auth.emailVerified'))
        setStage({ name: 'sign-in' })
        setPassword('')
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleResend = async () => {
    if (stage.name !== 'verify') return
    setBusy(true)
    setError(null)
    try {
      await resendConfirmationCode(stage.email)
      setInfo(t('auth.codeResent'))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await forgotPassword(email.trim())
      setInfo(t('auth.resetCodeSent'))
      setStage({ name: 'reset', email: email.trim() })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (stage.name !== 'reset') return
    setBusy(true)
    setError(null)
    try {
      await confirmForgotPassword(stage.email, code.trim(), newPassword)
      setInfo(t('auth.passwordReset'))
      setStage({ name: 'sign-in' })
      setPassword('')
      setNewPassword('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <button
        onClick={onCancel}
        className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4"
      >
        {t('common.back')}
      </button>

      <div className="flex items-center gap-3 mb-1">
        <BrandMark className="w-10 h-10" />
        <h2 className="font-display text-3xl font-extrabold text-ink-900">
          {stage.name === 'sign-up' && t('auth.signUpHeader')}
          {stage.name === 'sign-in' && t('auth.signInHeader')}
          {stage.name === 'verify' && t('auth.verifyHeader')}
          {stage.name === 'forgot' && t('auth.forgotHeader')}
          {stage.name === 'reset' && t('auth.resetHeader')}
        </h2>
      </div>
      <p className="text-sm text-ink-600 mb-6 leading-relaxed">
        {stage.name === 'sign-up' && t('auth.signUpIntro')}
        {stage.name === 'sign-in' && t('auth.signInIntro')}
        {stage.name === 'verify' && t('auth.verifyIntro', { email: stage.email })}
        {stage.name === 'forgot' && t('auth.forgotIntro')}
        {stage.name === 'reset' && t('auth.resetIntro')}
      </p>

      {info && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 bg-brand-50 border border-brand-200 rounded-xl p-3 text-sm text-brand-800 leading-relaxed"
        >
          {info}
        </div>
      )}
      {error && (
        <div
          id="auth-error"
          role="alert"
          className="mb-4 bg-accent-50 border border-accent-300 rounded-xl p-3 text-sm text-accent-800 leading-relaxed break-words"
        >
          {error}
        </div>
      )}

      {(stage.name === 'sign-in' || stage.name === 'sign-up') && federationConfigured() && (
        <div className="flex flex-col gap-2 mb-5">
          <button
            type="button"
            onClick={() => redirectToProvider('SignInWithApple')}
            className="w-full bg-ink-900 hover:bg-ink-800 text-white font-semibold py-3 rounded-xl shadow-md transition-colors flex items-center justify-center gap-2"
          >
            <span aria-hidden></span>
            {t('auth.continueWithApple')}
          </button>
          <button
            type="button"
            onClick={() => redirectToProvider('Google')}
            className="w-full bg-white hover:bg-paper-100 border border-paper-300 text-ink-900 font-semibold py-3 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
          >
            {t('auth.continueWithGoogle')}
          </button>
          <div className="flex items-center gap-3 my-2 text-xs text-ink-500">
            <div className="flex-1 h-px bg-paper-300" />
            <span>{t('auth.orDivider')}</span>
            <div className="flex-1 h-px bg-paper-300" />
          </div>
        </div>
      )}

      {(stage.name === 'sign-in' || stage.name === 'sign-up') && (
        <form
          onSubmit={stage.name === 'sign-in' ? handleSignIn : handleSignUp}
          className="flex flex-col gap-3"
        >
          <label className="text-sm font-semibold text-ink-700">
            {t('auth.email')}
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'auth-error' : undefined}
              className="mt-1 w-full border border-paper-300 rounded-xl px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
          <label className="text-sm font-semibold text-ink-700">
            {t('auth.password')}
            <input
              type="password"
              autoComplete={stage.name === 'sign-up' ? 'new-password' : 'current-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'auth-error' : undefined}
              className="mt-1 w-full border border-paper-300 rounded-xl px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            {stage.name === 'sign-up' && (
              <span className="block mt-1 text-xs text-ink-500 font-normal">
                {t('auth.passwordHelp')}
              </span>
            )}
          </label>
          <button
            type="submit"
            disabled={busy}
            className="bg-gradient-to-r from-brand-500 via-brand-500 to-purple-600 hover:brightness-110 active:brightness-95 disabled:bg-none disabled:bg-brand-300 text-white font-semibold py-3 rounded-xl shadow-md shadow-brand-500/20 transition-colors mt-2"
          >
            {busy
              ? stage.name === 'sign-in'
                ? t('auth.signingIn')
                : t('auth.creatingAccount')
              : stage.name === 'sign-in'
                ? t('auth.signInBtn')
                : t('auth.createAccountBtn')}
          </button>
        </form>
      )}

      {stage.name === 'verify' && (
        <form onSubmit={handleVerify} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-ink-700">
            {t('auth.verificationCode')}
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'auth-error' : undefined}
              className="mt-1 w-full border border-paper-300 rounded-xl px-3 py-2.5 text-base font-mono tracking-widest focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white font-semibold py-3 rounded-xl shadow-md shadow-brand-500/20 transition-colors"
          >
            {busy ? t('auth.verifying') : t('auth.verifyBtn')}
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={busy}
            className="text-sm text-brand-700 hover:text-brand-800 underline self-center mt-1"
          >
            {t('auth.resendCode')}
          </button>
        </form>
      )}

      {stage.name === 'forgot' && (
        <form onSubmit={handleForgot} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-ink-700">
            {t('auth.email')}
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'auth-error' : undefined}
              className="mt-1 w-full border border-paper-300 rounded-xl px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white font-semibold py-3 rounded-xl shadow-md transition-colors"
          >
            {busy ? t('auth.sending') : t('auth.sendResetCode')}
          </button>
        </form>
      )}

      {stage.name === 'reset' && (
        <form onSubmit={handleReset} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-ink-700">
            {t('auth.codeFromEmail')}
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'auth-error' : undefined}
              className="mt-1 w-full border border-paper-300 rounded-xl px-3 py-2.5 text-base font-mono tracking-widest focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
          <label className="text-sm font-semibold text-ink-700">
            {t('auth.newPassword')}
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'auth-error' : undefined}
              className="mt-1 w-full border border-paper-300 rounded-xl px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white font-semibold py-3 rounded-xl shadow-md transition-colors"
          >
            {busy ? t('auth.saving') : t('auth.resetPasswordBtn')}
          </button>
        </form>
      )}

      {/* Bottom links */}
      <div className="mt-6 text-center text-sm text-ink-600 space-y-2">
        {stage.name === 'sign-in' && (
          <>
            <button onClick={() => goTo({ name: 'sign-up' })} className="text-brand-700 hover:text-brand-800 underline">
              {t('auth.noAccount')}
            </button>
            <span className="mx-2" aria-hidden="true">·</span>
            <button onClick={() => goTo({ name: 'forgot' })} className="text-brand-700 hover:text-brand-800 underline">
              {t('auth.forgotPasswordLink')}
            </button>
          </>
        )}
        {stage.name === 'sign-up' && (
          <button onClick={() => goTo({ name: 'sign-in' })} className="text-brand-700 hover:text-brand-800 underline">
            {t('auth.haveAccount')}
          </button>
        )}
        {(stage.name === 'forgot' || stage.name === 'reset' || stage.name === 'verify') && (
          <button onClick={() => goTo({ name: 'sign-in' })} className="text-brand-700 hover:text-brand-800 underline">
            {t('auth.backToSignIn')}
          </button>
        )}
      </div>

      <p className="mt-auto pt-8 text-xs text-ink-500 text-center leading-relaxed">
        {t('auth.footer')}
      </p>
    </div>
  )
}
