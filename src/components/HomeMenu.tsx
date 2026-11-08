import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Icon, { type IconName } from './Icon'

/**
 * The home screen below the scan button (build spec T4 item 9, the home
 * layout T4 owns): three glass rows, then the workday link, then the fine
 * link.
 *
 * Rows and links whose screens are built on other branches render only
 * when App passes their handler, so the merge that brings a screen in only
 * wires its handler:
 * - `onOpenWeeklyReminders` (T5a): "Street sweeping and weekly reminders",
 *   with `weeklyRemindersNext` shown inline under the title (the next
 *   occurrence when it is within 24 hours, worded by T5a) and
 *   `weeklyRemindersDetail` as its right-hand label.
 * - `onStartWorkday` (T6b): "Parking all day? Start a workday". T6b decides
 *   when it shows (hidden during a workday, and where workday mode isn't
 *   available) by passing the handler or not.
 * - `onOpenNoticeLookup` (T8): "Got a fine? Start here". Until it is wired,
 *   `onDraftAppeal` keeps the appeal flow's own entry in that place.
 */
interface Props {
  /** History is hidden for first-time visitors (nothing saved, nothing active). */
  showHistory: boolean
  /** How many records are saved, for the History row's right-hand label. */
  recordCount: number
  onOpenHistory: () => void
  onOpenWeeklyReminders?: () => void
  weeklyRemindersNext?: ReactNode
  weeklyRemindersDetail?: ReactNode
  onOpenSettings: () => void
  /** Sign-in is set up on this build. Without it, Settings has no right-hand label. */
  syncAvailable: boolean
  /** The signed-in email, Settings' right-hand label. Null while nobody is signed in. */
  accountEmail: string | null
  onStartWorkday?: () => void
  onOpenNoticeLookup?: () => void
  onDraftAppeal?: () => void
}

const GLASS = { background: 'rgba(255,255,255,0.055)' }
const LINK =
  'text-sm text-[#7BE3A4] hover:text-paper-50 font-medium underline self-center min-h-[44px] inline-flex items-center py-2.5'

/** One glass row: icon, title (and an optional line under it), right-hand label. */
function GlassRow({
  icon,
  title,
  sub,
  detail,
  onClick,
}: {
  icon: IconName
  title: string
  sub?: ReactNode
  detail?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="gf-card w-full text-paper-50 font-medium py-3 min-h-[44px] flex items-start justify-between gap-3 px-5 transition-colors hover:brightness-110"
      style={GLASS}
    >
      <span className="flex items-start gap-2 min-w-0 flex-1">
        <Icon name={icon} className="w-5 h-5 shrink-0 mt-px text-[#A9CFBE]" />
        <span className="min-w-0 text-left">
          <span className="block leading-snug">{title}</span>
          {sub ? <span className="block text-sm font-semibold mt-0.5 text-[#7BE3A4] leading-snug">{sub}</span> : null}
        </span>
      </span>
      {detail ? (
        <span className="text-sm shrink-0 mt-px pr-2 max-w-[45%] truncate" style={{ color: '#A9CFBE' }}>
          {detail}
        </span>
      ) : null}
    </button>
  )
}

export default function HomeMenu({
  showHistory,
  recordCount,
  onOpenHistory,
  onOpenWeeklyReminders,
  weeklyRemindersNext,
  weeklyRemindersDetail,
  onOpenSettings,
  syncAvailable,
  accountEmail,
  onStartWorkday,
  onOpenNoticeLookup,
  onDraftAppeal,
}: Props) {
  const { t } = useTranslation()
  const rows: Array<Parameters<typeof GlassRow>[0] & { key: string }> = []
  if (showHistory) {
    rows.push({
      key: 'history',
      icon: 'list',
      title: t('home.history'),
      detail: recordCount === 0 ? t('home.historyEmpty') : t('home.historyCount', { count: recordCount }),
      onClick: onOpenHistory,
    })
  }
  if (onOpenWeeklyReminders) {
    rows.push({
      key: 'weekly',
      icon: 'repeat',
      // T5's reviewed wording, the same key RecurringHomeRow reads.
      title: t('recurring.homeRow'),
      sub: weeklyRemindersNext,
      detail: weeklyRemindersDetail,
      onClick: onOpenWeeklyReminders,
    })
  }
  rows.push({
    key: 'settings',
    icon: 'settings',
    title: t('home.settings'),
    detail: accountEmail ?? (syncAvailable ? t('home.settingsSignIn') : null),
    onClick: onOpenSettings,
  })

  return (
    <>
      <nav className="mt-8 w-full flex flex-col gap-2">
        {rows.map(({ key, ...row }) => (
          <GlassRow key={key} {...row} />
        ))}
      </nav>

      {onStartWorkday && (
        <button type="button" onClick={onStartWorkday} className={`mt-6 ${LINK}`}>
          {t('home.startWorkday')}
        </button>
      )}

      {onOpenNoticeLookup ? (
        <button type="button" onClick={onOpenNoticeLookup} className={`${onStartWorkday ? 'mt-1' : 'mt-6'} ${LINK}`}>
          {t('home.fineStart')}
        </button>
      ) : onDraftAppeal ? (
        <button type="button" onClick={onDraftAppeal} className={`${onStartWorkday ? 'mt-1' : 'mt-6'} ${LINK}`}>
          {t('home.draftAppeal')}
        </button>
      ) : null}
    </>
  )
}
