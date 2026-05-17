import { useState } from 'react'
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
      if (/not confirmed|UserNotConfirmedException/i.test(msg)) {
        // Resume the verify flow if they signed up but never verified.
        setInfo("You haven't verified your email yet — enter the code below.")
        setStage({ name: 'verify', email: email.trim(), password })
      } else {
        setError(msg)
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
      setInfo("Account created. We've emailed you a verification code.")
      setStage({ name: 'verify', email: email.trim(), password })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
        setInfo('Email verified — sign in to continue.')
        setStage({ name: 'sign-in' })
        setPassword('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
      setInfo('Code re-sent. Check your inbox.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
      setInfo("We've emailed you a reset code.")
      setStage({ name: 'reset', email: email.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
      setInfo('Password reset. Sign in with your new password.')
      setStage({ name: 'sign-in' })
      setPassword('')
      setNewPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
        ← Back
      </button>

      <div className="flex items-center gap-3 mb-1">
        <BrandMark className="w-10 h-10" />
        <h2 className="font-display text-3xl font-extrabold text-ink-900">
          {stage.name === 'sign-up' && 'Create account'}
          {stage.name === 'sign-in' && 'Sign in'}
          {stage.name === 'verify' && 'Verify your email'}
          {stage.name === 'forgot' && 'Forgot password'}
          {stage.name === 'reset' && 'Reset password'}
        </h2>
      </div>
      <p className="text-sm text-ink-600 mb-6 leading-relaxed">
        {stage.name === 'sign-up' &&
          "Sync sessions across devices, recover them if you lose your phone, and keep evidence safe even after you uninstall."}
        {stage.name === 'sign-in' && 'Welcome back — pick up where you left off.'}
        {stage.name === 'verify' &&
          `Enter the 6-digit code we emailed to ${stage.name === 'verify' && stage.email}.`}
        {stage.name === 'forgot' && "Enter your email — we'll send a reset code."}
        {stage.name === 'reset' && `Enter the code from your email + a new password.`}
      </p>

      {info && (
        <div className="mb-4 bg-brand-50 border border-brand-200 rounded-xl p-3 text-sm text-brand-800 leading-relaxed">
          {info}
        </div>
      )}
      {error && (
        <div className="mb-4 bg-accent-50 border border-accent-300 rounded-xl p-3 text-sm text-accent-800 leading-relaxed break-words">
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
            Continue with Apple
          </button>
          <button
            type="button"
            onClick={() => redirectToProvider('Google')}
            className="w-full bg-white hover:bg-paper-100 border border-paper-300 text-ink-900 font-semibold py-3 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
          >
            Continue with Google
          </button>
          <div className="flex items-center gap-3 my-2 text-xs text-ink-500">
            <div className="flex-1 h-px bg-paper-300" />
            <span>OR</span>
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
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border border-paper-300 rounded-xl px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
          <label className="text-sm font-semibold text-ink-700">
            Password
            <input
              type="password"
              autoComplete={stage.name === 'sign-up' ? 'new-password' : 'current-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full border border-paper-300 rounded-xl px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            {stage.name === 'sign-up' && (
              <span className="block mt-1 text-xs text-ink-500 font-normal">
                At least 8 chars with a mix of upper, lower and a number.
              </span>
            )}
          </label>
          <button
            type="submit"
            disabled={busy}
            className="bg-brand-500 hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-300 text-white font-semibold py-3 rounded-xl shadow-md shadow-brand-500/20 transition-colors mt-2"
          >
            {busy
              ? stage.name === 'sign-in'
                ? 'Signing in…'
                : 'Creating account…'
              : stage.name === 'sign-in'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>
      )}

      {stage.name === 'verify' && (
        <form onSubmit={handleVerify} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-ink-700">
            Verification code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 w-full border border-paper-300 rounded-xl px-3 py-2.5 text-base font-mono tracking-widest focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white font-semibold py-3 rounded-xl shadow-md shadow-brand-500/20 transition-colors"
          >
            {busy ? 'Verifying…' : 'Verify and sign in'}
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={busy}
            className="text-sm text-brand-700 hover:text-brand-800 underline self-center mt-1"
          >
            Re-send the code
          </button>
        </form>
      )}

      {stage.name === 'forgot' && (
        <form onSubmit={handleForgot} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-ink-700">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border border-paper-300 rounded-xl px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white font-semibold py-3 rounded-xl shadow-md transition-colors"
          >
            {busy ? 'Sending…' : 'Send reset code'}
          </button>
        </form>
      )}

      {stage.name === 'reset' && (
        <form onSubmit={handleReset} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-ink-700">
            Code from email
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 w-full border border-paper-300 rounded-xl px-3 py-2.5 text-base font-mono tracking-widest focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
          <label className="text-sm font-semibold text-ink-700">
            New password
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 w-full border border-paper-300 rounded-xl px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white font-semibold py-3 rounded-xl shadow-md transition-colors"
          >
            {busy ? 'Saving…' : 'Reset password'}
          </button>
        </form>
      )}

      {/* Bottom links */}
      <div className="mt-6 text-center text-sm text-ink-600 space-y-2">
        {stage.name === 'sign-in' && (
          <>
            <button onClick={() => goTo({ name: 'sign-up' })} className="text-brand-700 hover:text-brand-800 underline">
              No account? Create one
            </button>
            <span className="mx-2">·</span>
            <button onClick={() => goTo({ name: 'forgot' })} className="text-brand-700 hover:text-brand-800 underline">
              Forgot password
            </button>
          </>
        )}
        {stage.name === 'sign-up' && (
          <button onClick={() => goTo({ name: 'sign-in' })} className="text-brand-700 hover:text-brand-800 underline">
            Already have an account? Sign in
          </button>
        )}
        {(stage.name === 'forgot' || stage.name === 'reset' || stage.name === 'verify') && (
          <button onClick={() => goTo({ name: 'sign-in' })} className="text-brand-700 hover:text-brand-800 underline">
            Back to sign in
          </button>
        )}
      </div>

      <p className="mt-auto pt-8 text-xs text-ink-500 text-center leading-relaxed">
        Cloud sync is optional. ParkProof works fully offline without an account —
        your data lives on this device. Signing in just lets you see it on others.
      </p>
    </div>
  )
}
