import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/use-auth'
import { isStorageFullError, loadProfile, saveProfile } from '../lib/storage'
import {
  DRIVER_NAME_MAX,
  MAX_SAVED_PERMITS,
  PERMIT_AREA_MAX,
  PERMIT_TYPES,
  PERMIT_TYPE_KEYS,
  STATE_CODES,
  STATE_NAME_KEYS,
  isDateOnly,
  isPermitExpired,
  newPermitId,
} from '../lib/profile'
import type { DriverProfile, Jurisdiction, SavedPermit, UserPermitType } from '../types'
import PushManagementSection from './PushManagementSection'
import BackButton from './ui/BackButton'
import Button from './ui/Button'
import Card from './ui/Card'
import Input from './ui/Input'

interface Props {
  onBack: () => void
  /** Open Account (cloud sync, export, delete). Shown only while signed in. */
  onOpenAccount: () => void
  /** Open sign-in. Shown only when sign-in is set up and nobody is signed in. */
  onSignIn: () => void
  onOpenPrivacy: () => void
}

const LABEL = 'text-xs uppercase tracking-widest font-semibold text-ink-600'

/** The add-a-permit form while it is open. */
interface PermitForm {
  type: UserPermitType | null
  state: Jurisdiction | ''
  area: string
  /** '' or the date input's 'YYYY-MM-DD'. */
  expires_on: string
  /** An accessible permit's warning is on screen, waiting for "Save this permit". */
  confirming: boolean
}

const EMPTY_FORM: PermitForm = { type: null, state: '', area: '', expires_on: '', confirming: false }

/**
 * A 'YYYY-MM-DD' date in the app's language, as printed on the permit (no
 * time zone involved). English uses Australian date order, as elsewhere in
 * the app.
 */
function formatPermitDate(date: string, language: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const locale = language === 'en' || language.startsWith('en-') ? 'en-AU' : language
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(y, m - 1, d)),
    )
  } catch {
    return date
  }
}

/**
 * Settings (build spec T4 items 1 and 2): the driver's name for new records,
 * saved permits, notifications on this device, and the way to Account.
 * Works without an account; everything here is stored in this browser only
 * (`parkproof.profile.v1`, via loadProfile and saveProfile).
 */
export default function Settings({ onBack, onOpenAccount, onSignIn, onOpenPrivacy }: Props) {
  const { t, i18n } = useTranslation()
  const auth = useAuth()
  const ids = useId()
  const [profile, setProfile] = useState<DriverProfile>(() => loadProfile())
  const [name, setName] = useState(() => profile.driver_name ?? '')
  const [nameStatus, setNameStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [form, setForm] = useState<PermitForm | null>(null)
  const [permitError, setPermitError] = useState<string | null>(null)
  // When the add-a-permit form closes from one of its own buttons, focus
  // goes back to "Add a permit" (or the section heading at the limit), not
  // to the top of the page.
  const returnFocus = useRef(false)
  const permitsHeading = useRef<HTMLHeadingElement>(null)
  const permitsAction = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (form || !returnFocus.current) return
    returnFocus.current = false
    const target = permitsAction.current?.querySelector<HTMLElement>('button') ?? permitsHeading.current
    target?.focus()
  }, [form])

  const errorText = (err: unknown) => (isStorageFullError(err) ? t('errors.storageFull') : t('prefs.saveFailed'))

  /** Save on top of the latest stored profile, so another tab's change isn't lost. */
  const store = (change: (current: DriverProfile) => DriverProfile): DriverProfile => {
    const stored = saveProfile(change(loadProfile()))
    setProfile(stored)
    return stored
  }

  const nameChanged = (name.trim() || null) !== profile.driver_name

  const saveName = () => {
    try {
      const stored = store((current) => ({ ...current, driver_name: name }))
      setName(stored.driver_name ?? '')
      setNameStatus('saved')
    } catch (err) {
      console.warn('[settings] could not save the driver name:', err)
      setNameStatus('error')
    }
  }

  const savePermit = (f: PermitForm) => {
    if (!f.type) return
    // An accessible permit is health information: say what saving it means
    // before anything is stored (spec T4 item 2).
    if (f.type === 'accessible' && !f.confirming) {
      setForm({ ...f, confirming: true })
      return
    }
    const permit: SavedPermit = {
      id: newPermitId(),
      type: f.type,
      state: f.state || null,
      area: f.type === 'accessible' ? null : f.area,
      expires_on: isDateOnly(f.expires_on) ? f.expires_on : null,
    }
    try {
      const stored = store((current) => ({ ...current, permits: [...current.permits, permit] }))
      if (!stored.permits.some((p) => p.id === permit.id)) {
        // Already at the limit (another tab added one meanwhile).
        setPermitError(t('prefs.permitsLimit', { count: MAX_SAVED_PERMITS }))
        return
      }
      setPermitError(null)
      returnFocus.current = true
      setForm(null)
    } catch (err) {
      console.warn('[settings] could not save the permit:', err)
      setPermitError(errorText(err))
    }
  }

  const deletePermit = (id: string) => {
    try {
      store((current) => ({ ...current, permits: current.permits.filter((p) => p.id !== id) }))
      setPermitError(null)
    } catch (err) {
      console.warn('[settings] could not delete the permit:', err)
      setPermitError(errorText(err))
    }
  }

  const permitSummary = (p: SavedPermit): string[] =>
    [p.state ? t(STATE_NAME_KEYS[p.state]) : null, p.area ? t('prefs.permitArea', { area: p.area }) : null].filter(
      (s): s is string => s !== null,
    )

  const canAdd = profile.permits.length < MAX_SAVED_PERMITS

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton onClick={onBack}>{t('common.back')}</BackButton>

      <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-1">{t('prefs.header')}</h2>
      <p className="text-sm mb-6 leading-relaxed" style={{ color: '#A9CFBE' }}>
        {t('prefs.intro')}
      </p>

      {/* The driver's name. New records start with it as the driver. */}
      <Card className="mb-3">
        <label htmlFor={`${ids}-name`} className={`${LABEL} block`}>
          {t('prefs.driverNameLabel')}{' '}
          <span className="normal-case tracking-normal font-normal">({t('common.optional')})</span>
        </label>
        <p id={`${ids}-name-hint`} className="text-xs text-ink-600 mt-1 mb-2 leading-relaxed">
          {t('prefs.driverNameHint')}
        </p>
        <Input
          id={`${ids}-name`}
          value={name}
          maxLength={DRIVER_NAME_MAX}
          autoComplete="name"
          aria-describedby={`${ids}-name-hint`}
          onChange={(e) => {
            setName(e.target.value)
            setNameStatus('idle')
          }}
        />
        <div className="flex items-center gap-3 mt-3">
          <Button variant="secondary" size="sm" className="px-4 min-h-[44px]" onClick={saveName} disabled={!nameChanged}>
            {t('prefs.saveName')}
          </Button>
          <p role="status" aria-live="polite" className="text-xs text-ink-600">
            {nameStatus === 'saved' ? t('prefs.saved') : nameStatus === 'error' ? t('prefs.saveFailed') : ''}
          </p>
        </div>
      </Card>

      {/* Saved permits: sent (type, and area for resident or business) with each scan. */}
      <Card className="mb-3">
        <h3 ref={permitsHeading} tabIndex={-1} className="font-display font-bold text-ink-900 mb-1 focus:outline-none">
          {t('prefs.permitsHeader')}
        </h3>
        <p className="text-xs text-ink-600 mb-3 leading-relaxed">{t('prefs.permitsIntro')}</p>

        {profile.permits.length === 0 && !form && <p className="text-sm text-ink-700 mb-3">{t('prefs.permitsEmpty')}</p>}

        {profile.permits.length > 0 && (
          <ul className="space-y-2 mb-3">
            {profile.permits.map((p) => {
              const expired = isPermitExpired(p)
              const details = permitSummary(p)
              return (
                <li key={p.id} className="border border-paper-300 rounded-lg p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-900">{t(PERMIT_TYPE_KEYS[p.type])}</p>
                    {details.length > 0 && <p className="text-xs text-ink-600 mt-0.5 break-words">{details.join(' · ')}</p>}
                    {p.expires_on && (
                      <p className={`text-xs mt-0.5 ${expired ? 'text-accent-700 font-medium' : 'text-ink-600'}`}>
                        {expired
                          ? t('prefs.permitExpired', { date: formatPermitDate(p.expires_on, i18n.language) })
                          : t('prefs.permitExpires', { date: formatPermitDate(p.expires_on, i18n.language) })}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => deletePermit(p.id)}
                    aria-label={t('prefs.deletePermitLabel', { permit: t(PERMIT_TYPE_KEYS[p.type]) })}
                    className="shrink-0 min-h-[44px] min-w-[44px] px-2 -my-2 -mr-1 text-sm text-accent-700 hover:text-accent-800 underline"
                  >
                    {t('common.delete')}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div ref={permitsAction}>
          {form ? (
            <PermitFormFields
              form={form}
              onChange={(next) => {
                setForm(next)
                setPermitError(null)
              }}
              onSave={() => savePermit(form)}
              onCancel={() => {
                returnFocus.current = true
                setForm(null)
                setPermitError(null)
              }}
            />
          ) : canAdd ? (
            <Button variant="outline" size="sm" className="w-full min-h-[44px]" onClick={() => setForm(EMPTY_FORM)}>
              {t('prefs.addPermit')}
            </Button>
          ) : (
            <p className="text-xs text-ink-600">{t('prefs.permitsLimit', { count: MAX_SAVED_PERMITS })}</p>
          )}
        </div>

        {permitError && (
          <p role="alert" className="text-xs text-accent-700 mt-2 break-words">
            {permitError}
          </p>
        )}
      </Card>

      {/* Notifications on this device. */}
      <PushManagementSection />

      {/* Account: never needed for anything above. */}
      {auth.user ? (
        <Card className="mb-3">
          <h3 className="font-display font-bold text-ink-900 mb-1">{t('prefs.accountHeader')}</h3>
          <p className="text-sm text-ink-900 break-words">{auth.user.email}</p>
          <p className="text-xs text-ink-600 mt-1 mb-3 leading-relaxed">{t('prefs.accountCopy')}</p>
          <Button variant="outline" size="sm" className="w-full min-h-[44px]" onClick={onOpenAccount}>
            {t('prefs.openAccount')}
          </Button>
        </Card>
      ) : auth.configured ? (
        <Card className="mb-3">
          <h3 className="font-display font-bold text-ink-900 mb-1">{t('prefs.accountHeader')}</h3>
          <p className="text-xs text-ink-600 mb-3 leading-relaxed">{t('prefs.signInCopy')}</p>
          <Button variant="outline" size="sm" className="w-full min-h-[44px]" onClick={onSignIn}>
            {t('prefs.signIn')}
          </Button>
        </Card>
      ) : null}

      <button
        type="button"
        onClick={onOpenPrivacy}
        className="self-center mt-4 text-sm text-[#7BE3A4] hover:text-paper-50 font-medium underline min-h-[44px] inline-flex items-center"
      >
        {t('prefs.privacyCta')}
      </button>
    </div>
  )
}

/** The add-a-permit form: type, issuing state, area (resident and business only), expiry. */
function PermitFormFields({
  form,
  onChange,
  onSave,
  onCancel,
}: {
  form: PermitForm
  onChange: (next: PermitForm) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const ids = useId()
  const set = (patch: Partial<PermitForm>) => onChange({ ...form, ...patch, confirming: false })
  const hasArea = form.type === 'resident' || form.type === 'business'
  // "Save permit" goes away when the warning shows: focus moves to the
  // warning, so a keyboard or switch user reads it and tabs straight to
  // "Save this permit" or Cancel.
  const warning = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (form.confirming) warning.current?.focus()
  }, [form.confirming])

  return (
    <div className="border border-paper-300 rounded-lg p-3 space-y-4">
      <fieldset>
        <legend className={LABEL}>{t('prefs.permitTypeLabel')}</legend>
        <div className="mt-2 space-y-2">
          {PERMIT_TYPES.map((type) => (
            <label
              key={type}
              className={`flex items-center gap-3 min-h-[44px] px-3 rounded-lg border cursor-pointer ${
                form.type === type ? 'border-brand-500 bg-brand-50' : 'border-paper-300'
              }`}
            >
              <input
                type="radio"
                name={`${ids}-type`}
                value={type}
                checked={form.type === type}
                onChange={() => set({ type })}
                className="w-5 h-5 accent-brand-500 shrink-0"
              />
              <span className="text-sm text-ink-900">{t(PERMIT_TYPE_KEYS[type])}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${ids}-state`} className={`${LABEL} block mb-2`}>
          {t('prefs.issuingStateLabel')}
        </label>
        <select
          id={`${ids}-state`}
          value={form.state}
          onChange={(e) => set({ state: e.target.value as Jurisdiction | '' })}
          className="w-full min-h-[44px] bg-white text-ink-900 border border-paper-300 rounded-lg px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="">{t('prefs.stateNotSet')}</option>
          {STATE_CODES.map((code) => (
            <option key={code} value={code}>
              {t(STATE_NAME_KEYS[code])}
            </option>
          ))}
        </select>
      </div>

      {hasArea && (
        <div>
          <label htmlFor={`${ids}-area`} className={`${LABEL} block mb-2`}>
            {t('prefs.areaLabel')}{' '}
            <span className="normal-case tracking-normal font-normal">({t('common.optional')})</span>
          </label>
          <Input
            id={`${ids}-area`}
            value={form.area}
            maxLength={PERMIT_AREA_MAX}
            placeholder={t('prefs.areaPlaceholder')}
            onChange={(e) => set({ area: e.target.value })}
          />
        </div>
      )}

      <div>
        <label htmlFor={`${ids}-expiry`} className={`${LABEL} block mb-2`}>
          {t('prefs.expiryLabel')}{' '}
          <span className="normal-case tracking-normal font-normal">({t('common.optional')})</span>
        </label>
        <Input
          id={`${ids}-expiry`}
          type="date"
          value={form.expires_on}
          className="min-h-[44px]"
          onChange={(e) => set({ expires_on: e.target.value })}
        />
      </div>

      {form.confirming ? (
        // Shown before an accessible permit is stored, with the choice to
        // save it or not (spec T4 item 2, exact wording).
        <div ref={warning} tabIndex={-1} role="alert" className="bg-amber-50 border border-amber-300 rounded-lg p-3">
          <p className="text-sm text-amber-900 leading-relaxed">{t('prefs.accessibleWarning')}</p>
          <div className="flex gap-2 mt-3">
            <Button variant="primary" size="sm" className="flex-1 min-h-[44px]" onClick={onSave}>
              {t('prefs.accessibleConfirm')}
            </Button>
            <Button variant="outline" size="sm" className="flex-1 min-h-[44px]" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="primary" size="sm" className="flex-1 min-h-[44px]" onClick={onSave} disabled={!form.type}>
            {t('prefs.savePermit')}
          </Button>
          <Button variant="outline" size="sm" className="flex-1 min-h-[44px]" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}
